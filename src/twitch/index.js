import { loadConfig } from '../config.js';
import { validateConfiguredTwitchAuth } from './auth.js';
import { createEventSubClient } from './eventsub.js';
import { createChatHandler } from './chatHandler.js';
import { createChannelPointsHandler } from './channelPointsHandler.js';
import { createRedemptionService } from './redemptionService.js';
import { createCurseEngine } from '../engine/curseEngine.js';
import { logger as defaultLogger } from '../utils/logger.js';

const TOKEN_REVALIDATION_INTERVAL_MS = 60 * 60 * 1000;

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

  // Chat and Channel Points share this one activation path and Curse Engine.
  const activateFromTwitch = (request) =>
    reportEngineResult(engine.activate(request), request.source);

  const handleChatMessage = createChatHandler({
    activateCurse: activateFromTwitch,
    onError: (error) => logger.error('Chat command processing failed', { message: error.message })
  });

  // Fulfillment is deliberately disabled under channel:read:redemptions.
  // It requires channel:manage:redemptions, which is not requested by the MVP.
  const redemptionService = createRedemptionService({
    clientId: config.clientId,
    accessToken: config.accessToken,
    broadcasterUserId: config.broadcasterUserId,
    apiBaseUrl: config.apiBaseUrl,
    fetchImpl,
    canManageRedemptions: false
  });

  const handleRedemption = createChannelPointsHandler({
    gravityRewardId: config.gravityRewardId,
    activateCurse: activateFromTwitch,
    redemptionService,
    onProcessed: onRedemption,
    onError: (error, context) => logger.error('Channel Points processing failed', {
      message: error.message,
      ...context
    })
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
