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
 * One active EventSub WebSocket plus a temporary replacement socket during
 * Twitch's reconnect handover. Notifications are passed as complete Twitch
 * envelopes; application handlers consume them without raw socket coupling.
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
  let initialPromiseResolve;
  let initialPromiseReject;
  let initialPromise = null;
  const pendingSubscriptions = new Set();

  function resetKeepalive(timeoutSeconds) {
    if (keepaliveTimer) clearTimer(keepaliveTimer);
    if (!timeoutSeconds || timeoutSeconds <= 0) return;
    keepaliveTimer = setTimer(() => {
      logger.warn('EventSub keepalive timeout; starting a fresh session');
      if (activeSocket && activeSocket.readyState === WebSocketImpl.OPEN) {
        activeSocket.close(4000, 'EventSub keepalive timeout');
      } else {
        scheduleFreshConnection();
      }
    }, timeoutSeconds * 1000);
  }

  async function registerSubscriptions(sessionId) {
    const subscriptions = buildEventSubSubscriptions({
      broadcasterUserId: config.broadcasterUserId,
      botUserId: config.botUserId ?? config.broadcasterUserId,
      sessionId
    });

    for (const subscription of subscriptions) {
      const key = `${subscription.type}:${sessionId}`;
      if (pendingSubscriptions.has(key)) continue;
      pendingSubscriptions.add(key);
      try {
        await createEventSubSubscription({
          clientId: config.clientId,
          accessToken: config.accessToken,
          subscription,
          fetchImpl
        });
        logger.info('EventSub subscription registered', { type: subscription.type });
      } finally {
        pendingSubscriptions.delete(key);
      }
    }
  }

  function finishHandover(newSocket) {
    const oldSocket = activeSocket;
    activeSocket = newSocket;
    handoverSocket = null;
    if (oldSocket && oldSocket !== newSocket && oldSocket.readyState < WebSocketImpl.CLOSING) {
      oldSocket.close(1000, 'EventSub reconnect handover complete');
    }
    onStatus({ state: 'connected', sessionId: activeSessionId });
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

  function connect(url, { handover = false } = {}) {
    return new Promise((resolve, reject) => {
      if (stopped) return reject(new Error('EventSub client has been stopped'));
      const socket = new WebSocketImpl(url);
      if (handover) handoverSocket = socket;
      else if (!activeSocket || activeSocket.readyState >= WebSocketImpl.CLOSING) activeSocket = socket;

      let welcomed = false;
      socket.on('open', () => {
        onStatus({ state: 'socket-open', handover });
      });

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
          const session = message.payload?.session;
          if (!session?.id) {
            reject(new Error('EventSub welcome did not include a session ID'));
            return;
          }
          welcomed = true;
          if (!handover) activeSessionId = session.id;
          resetKeepalive(session.keepalive_timeout_seconds);

          try {
            // Twitch allows 10 seconds by default after welcome. Make these
            // requests immediately and sequentially to avoid startup delay.
            if (!handover) {
              await registerSubscriptions(session.id);
            }
            if (handover) {
              activeSessionId = session.id;
              finishHandover(socket);
            }
            onStatus({ state: 'welcomed', sessionId: session.id, handover });
            resolve({ sessionId: session.id });
            if (initialPromiseResolve && !initialPromise) {
              initialPromiseResolve({ sessionId: session.id });
              initialPromiseResolve = null;
              initialPromiseReject = null;
            }
          } catch (error) {
            reject(error);
            logger.error('EventSub subscription registration failed', { message: error.message });
            socket.close();
          }
          return;
        }

        if (messageType === 'session_keepalive') {
          resetKeepalive(activeSocket === socket
            ? (message.payload?.session?.keepalive_timeout_seconds ?? 0)
            : 0);
          onStatus({ state: 'keepalive' });
          return;
        }

        if (messageType === 'session_reconnect') {
          const reconnectUrl = message.payload?.session?.reconnect_url;
          if (typeof reconnectUrl !== 'string' || !reconnectUrl.startsWith('wss://')) {
            logger.error('EventSub reconnect message contained an invalid URL');
            return;
          }
          // Use Twitch's URL unchanged. Keep old socket alive until the
          // replacement socket sends session_welcome.
          connect(reconnectUrl, { handover: true }).catch((error) => {
            logger.error('EventSub handover failed', { message: error.message });
          });
          return;
        }

        if (messageType === 'notification') {
          resetKeepalive(activeSocket === socket
            ? (config.keepaliveTimeoutSeconds ?? 30)
            : 0);
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
          return;
        }
      });

      socket.on('close', (code, reason) => {
        if (keepaliveTimer) clearTimer(keepaliveTimer);
        onStatus({ state: 'closed', code, reason: reason?.toString?.() ?? '' });
        if (socket === handoverSocket) handoverSocket = null;
        if (socket === activeSocket && !stopped) {
          activeSessionId = null;
          scheduleFreshConnection();
        }
        if (!welcomed) reject(new Error(`EventSub socket closed before welcome (code ${code})`));
      });

      socket.on('error', (error) => {
        logger.error('EventSub WebSocket error', { message: error.message });
        onStatus({ state: 'error', message: error.message });
        if (!welcomed) reject(error);
      });
    });
  }

  return Object.freeze({
    async start() {
      if (initialPromise) return initialPromise;
      initialPromise = new Promise((resolve, reject) => {
        initialPromiseResolve = resolve;
        initialPromiseReject = reject;
      });
      connect(config.eventSubUrl ?? DEFAULT_EVENTSUB_URL, { handover: false })
        .catch((error) => {
          if (initialPromiseReject) initialPromiseReject(error);
          initialPromiseResolve = null;
          initialPromiseReject = null;
        });
      return initialPromise;
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
