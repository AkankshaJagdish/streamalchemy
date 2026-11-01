import { loadConfig } from '../config.js';
import { validateConfiguredTwitchAuth } from './auth.js';
import { createEventSubClient } from './eventsub.js';
import { createChatHandler } from './chatHandler.js';
import { createCurseEngine } from '../engine/curseEngine.js';
import { logger as defaultLogger } from '../utils/logger.js';

const TOKEN_REVALIDATION_INTERVAL_MS = 60 * 60 * 1000;

export function createRedemptionHandler({
  activateCurse,
  onRedemption = async () => {},
  onError = () => {}
}) {
  if (typeof activateCurse !== 'function') {
    throw new TypeError('activateCurse must be a function');
  }

  return async function handleRedemption(notification) {
    if (notification?.metadata?.message_type !== 'notification') {
      return { handled: false, reason: 'not-a-notification' };
    }
    const type = notification.metadata.subscription_type
      ?? notification.payload?.subscription?.type;
    if (type !== 'channel.channel_points_custom_reward_redemption.add') {
      return { handled: false, reason: 'not-a-redemption' };
    }

    const event = notification.payload?.event;
    if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
      return { handled: false, reason: 'invalid-redemption' };
    }

    // Match the designated reward by title. No viewer-provided fields are
    // interpreted as code or used to select an arbitrary curse.
    const rewardTitle = event.reward?.title;
    if (typeof rewardTitle !== 'string' || rewardTitle.trim().toLowerCase() !== 'gravity curse') {
      return { handled: true, activated: false, reason: 'unsupported-reward' };
    }

    try {
      const result = await activateCurse({
        curse: 'gravity',
        source: 'channel-points',
        eventId: event.id,
        viewer: {
          id: event.user_id,
          username: event.user_login ?? event.user_name ?? 'unknown'
        }
      });
      await onRedemption(notification, result);
      return { handled: true, ...result };
    } catch (error) {
      onError(error);
      return { handled: true, activated: false, reason: 'activation-failed' };
    }
  };
}

export async function startTwitchIntegration({
  env = process.env,
  fetchImpl = fetch,
  WebSocketImpl,
  engine = createCurseEngine(),
  onRedemption = async () => {},
  onRevocation = () => {},
  onStatus = () => {},
  logger = defaultLogger,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  revalidationIntervalMs = TOKEN_REVALIDATION_INTERVAL_MS
} = {}) {
  const { twitch: config } = loadConfig(env);
  const auth = await validateConfiguredTwitchAuth({ config, fetchImpl });
  logger.info('Twitch token validated', {
    userId: auth.userId,
    login: auth.login,
    expiresIn: auth.expiresIn,
    scopes: auth.scopes
  });

  const reportEngineResult = (result, source) => {
    if (!result.activated && result.reason !== 'already-active') {
      logger.warn('Curse activation request rejected', { source, reason: result.reason });
    }
    return result;
  };

  // This exact same engine method handles both Twitch input sources.
  const activateFromTwitch = (request) =>
    reportEngineResult(engine.activate(request), request.source);

  const handleChatMessage = createChatHandler({
    activateCurse: activateFromTwitch,
    onError: (error) => logger.error('Chat command processing failed', { message: error.message })
  });

  const handleRedemption = createRedemptionHandler({
    activateCurse: activateFromTwitch,
    onRedemption,
    onError: (error) => logger.error('Redemption processing failed', { message: error.message })
  });

  const eventSub = createEventSubClient({
    config,
    fetchImpl,
    ...(WebSocketImpl ? { WebSocketImpl } : {}),
    onChatMessage: handleChatMessage,
    onRedemption: handleRedemption,
    onRevocation,
    onStatus,
    logger
  });

  let validationTimer = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (validationTimer) clearIntervalImpl(validationTimer);
    eventSub.stop();
    engine.shutdown();
  };

  try {
    const session = await eventSub.start();
    validationTimer = setIntervalImpl(async () => {
      try {
        await validateConfiguredTwitchAuth({ config, fetchImpl });
        logger.info('Twitch access token hourly validation succeeded');
      } catch (error) {
        logger.error('Twitch access token is no longer valid; stopping EventSub', {
          message: error.message
        });
        stop();
      }
    }, revalidationIntervalMs);

    return Object.freeze({
      auth,
      sessionId: session.sessionId,
      engine,
      stop,
      eventSub
    });
  } catch (error) {
    stop();
    throw error;
  }
}
