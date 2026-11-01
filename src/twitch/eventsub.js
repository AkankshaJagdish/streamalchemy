import WebSocket from 'ws';
import { createEventSubSubscription } from './api.js';
import { buildEventSubSubscriptions, EVENTSUB_TYPES } from './eventsubSubscriptions.js';
import { createLogger } from '../utils/logger.js';

const DEFAULT_EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';

export function parseEventSubMessage(raw) {
  let text;
  if (typeof raw === 'string') text = raw;
  else if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
  else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8');
  else if (ArrayBuffer.isView(raw)) text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  else throw new TypeError('Unsupported EventSub frame type');

  const message = JSON.parse(text);
  if (!message?.metadata?.message_type) {
    throw new TypeError('Malformed EventSub message: metadata.message_type is missing');
  }
  return message;
}

/**
 * Maintains one active EventSub socket and, only during an official reconnect
 * handover, one temporary replacement socket. Fresh sessions register both
 * subscriptions after Welcome. Reconnect handovers inherit subscriptions and
 * therefore must not create duplicates.
 */
export function createEventSubClient({
  config,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  onChatMessage = async () => {},
  onRedemption = async () => {},
  onRevocation = () => {},
  onNotification = () => {},
  onStatus = () => {},
  logger = createLogger(),
  reconnectDelayMs = 1_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  if (!config?.clientId || !config?.accessToken || !config?.broadcasterUserId) {
    throw new TypeError('EventSub client requires validated Twitch configuration');
  }

  let activeSocket = null;
  let handoverSocket = null;
  let activeSessionId = null;
  let keepaliveTimer = null;
  let reconnectTimer = null;
  let stopped = false;
  let startPromise = null;
  let startSettled = false;
  let startResolve;
  let startReject;

  function settleStart(error, value) {
    if (startSettled) return;
    startSettled = true;
    if (error) startReject(error);
    else startResolve(value);
  }

  function resetKeepalive(timeoutSeconds, socket) {
    if (keepaliveTimer) clearTimer(keepaliveTimer);
    if (!timeoutSeconds || timeoutSeconds <= 0 || socket !== activeSocket) return;
    keepaliveTimer = setTimer(() => {
      logger.warn('EventSub keepalive timeout; starting a fresh session');
      if (socket === activeSocket && socket.readyState < WebSocketImpl.CLOSING) {
        socket.close(4000, 'EventSub keepalive timeout');
      }
    }, timeoutSeconds * 1000);
  }

  async function registerSubscriptions(sessionId) {
    const subscriptions = buildEventSubSubscriptions({
      broadcasterUserId: config.broadcasterUserId,
      botUserId: config.botUserId ?? config.broadcasterUserId,
      sessionId
    });

    // Perform two requests immediately after Welcome; the default subscription
    // deadline is 10 seconds. Sequential execution avoids concurrent 409 races.
    for (const subscription of subscriptions) {
      try {
        await createEventSubSubscription({
          clientId: config.clientId,
          accessToken: config.accessToken,
          subscription,
          fetchImpl
        });
        logger.info('EventSub subscription registered', { type: subscription.type });
      } catch (error) {
        // A 409 is handled as an idempotent duplicate by api.js. Any other
        // failure must abort startup: a partially subscribed client is not ready.
        throw error;
      }
    }
  }

  function scheduleFreshConnection() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      connect(DEFAULT_EVENTSUB_URL, { handover: false }).catch((error) => {
        logger.error('EventSub reconnect failed', { message: error.message });
        scheduleFreshConnection();
      });
    }, reconnectDelayMs);
  }

  function finishHandover(newSocket, newSessionId) {
    const oldSocket = activeSocket;
    activeSocket = newSocket;
    activeSessionId = newSessionId;
    handoverSocket = null;

    // Existing subscriptions move with the Twitch reconnect URL. Do not create
    // them again on the replacement session.
    if (oldSocket && oldSocket !== newSocket && oldSocket.readyState < WebSocketImpl.CLOSING) {
      oldSocket.close(1000, 'EventSub reconnect handover complete');
    }
    onStatus({ state: 'connected', sessionId: newSessionId });
  }

  function connect(url, { handover = false } = {}) {
    return new Promise((resolve, reject) => {
      if (stopped) return reject(new Error('EventSub client has been stopped'));
      const socket = new WebSocketImpl(url);
      if (handover) handoverSocket = socket;
      else activeSocket = socket;

      let welcomed = false;
      let welcomeWorkStarted = false;

      socket.on('open', () => onStatus({ state: 'socket-open', handover }));

      socket.on('message', async (raw) => {
        let message;
        try {
          message = parseEventSubMessage(raw);
        } catch (error) {
          logger.warn('Ignoring malformed EventSub frame', { message: error.message });
          return;
        }

        const messageType = message.metadata.message_type;

        if (messageType === 'session_welcome') {
          if (welcomeWorkStarted) return;
          welcomeWorkStarted = true;
          const session = message.payload?.session;
          if (!session?.id) {
            const error = new Error('EventSub welcome did not include a session ID');
            reject(error);
            settleStart(error);
            return;
          }
          welcomed = true;

          try {
            if (handover) {
              // Do not disturb the old connection until replacement Welcome.
              finishHandover(socket, session.id);
            } else {
              activeSessionId = session.id;
              resetKeepalive(session.keepalive_timeout_seconds, socket);
              await registerSubscriptions(session.id);
            }
            onStatus({ state: 'welcomed', sessionId: session.id, handover });
            resolve({ sessionId: session.id });
            settleStart(null, { sessionId: session.id });
          } catch (error) {
            logger.error('EventSub subscription registration failed', { message: error.message });
            reject(error);
            settleStart(error);
            socket.close(1011, 'Subscription registration failed');
          }
          return;
        }

        if (messageType === 'session_keepalive') {
          if (socket === activeSocket) {
            resetKeepalive(config.keepaliveTimeoutSeconds ?? 30, socket);
          }
          onStatus({ state: 'keepalive' });
          return;
        }

        if (messageType === 'session_reconnect') {
          const reconnectUrl = message.payload?.session?.reconnect_url;
          if (typeof reconnectUrl !== 'string' || !reconnectUrl.startsWith('wss://')) {
            logger.error('EventSub reconnect message contained an invalid URL');
            return;
          }

          if (handoverSocket) {
            logger.warn('EventSub reconnect handover already in progress');
            return;
          }
          // URL must be used verbatim. The old socket remains active until the
          // replacement emits Welcome. Twitch carries the subscriptions over.
          connect(reconnectUrl, { handover: true }).catch((error) => {
            logger.error('EventSub handover failed', { message: error.message });
            if (handoverSocket?.readyState < WebSocketImpl.CLOSING) {
              handoverSocket.close();
            }
            handoverSocket = null;
          });
          return;
        }

        if (messageType === 'notification') {
          if (socket === activeSocket) {
            resetKeepalive(config.keepaliveTimeoutSeconds ?? 30, socket);
          }
          onNotification(message);
          const type = message.metadata.subscription_type ?? message.payload?.subscription?.type;
          try {
            if (type === EVENTSUB_TYPES.CHAT_MESSAGE) await onChatMessage(message);
            else if (type === EVENTSUB_TYPES.CHANNEL_POINTS_REDEMPTION) await onRedemption(message);
          } catch (error) {
            logger.error('EventSub notification handler failed', { type, message: error.message });
          }
          return;
        }

        if (messageType === 'revocation') {
          const subscription = message.payload?.subscription;
          logger.warn('EventSub subscription revoked', {
            type: subscription?.type,
            status: subscription?.status
          });
          onRevocation(subscription, message);
        }
      });

      socket.on('close', (code, reason) => {
        if (socket === activeSocket && keepaliveTimer) {
          clearTimer(keepaliveTimer);
          keepaliveTimer = null;
        }
        onStatus({ state: 'closed', code, reason: reason?.toString?.() ?? '' });

        if (socket === handoverSocket) handoverSocket = null;
        if (socket === activeSocket && !stopped) {
          activeSessionId = null;
          // A transport loss is not a reconnect handover. Fresh Welcome means
          // Twitch no longer has active subscriptions, so register them anew.
          scheduleFreshConnection();
        }
        if (!welcomed) {
          const error = new Error(`EventSub socket closed before welcome (code ${code})`);
          reject(error);
          if (!handover) settleStart(error);
        }
      });

      socket.on('error', (error) => {
        logger.error('EventSub WebSocket error', { message: error.message });
        onStatus({ state: 'error', message: error.message });
        if (!welcomed) {
          reject(error);
          if (!handover) settleStart(error);
        }
      });
    });
  }

  return Object.freeze({
    start() {
      if (startPromise) return startPromise;
      startPromise = new Promise((resolve, reject) => {
        startResolve = resolve;
        startReject = reject;
      });
      connect(config.eventSubUrl ?? DEFAULT_EVENTSUB_URL, { handover: false }).catch((error) => {
        settleStart(error);
      });
      return startPromise;
    },
    stop() {
      stopped = true;
      if (keepaliveTimer) clearTimer(keepaliveTimer);
      if (reconnectTimer) clearTimer(reconnectTimer);
      activeSocket?.close(1000, 'Application shutdown');
      if (handoverSocket && handoverSocket !== activeSocket) {
        handoverSocket.close(1000, 'Application shutdown');
      }
      activeSocket = null;
      handoverSocket = null;
      activeSessionId = null;
    },
    getSessionId() {
      return activeSessionId;
    }
  });
}
