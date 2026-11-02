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
  env = process.env, fetchImpl = fetch, WebSocketImpl, engine = createCurseEngine(),
  onRedemption = async () => {}, onRevocation = () => {}, onStatus = () => {},
  logger = defaultLogger, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
  revalidationIntervalMs = TOKEN_REVALIDATION_INTERVAL_MS
} = {}) {
  const { twitch: config } = loadConfig(env);
  const mockMode = config.eventSubMode === 'mock';
  let auth = null;

  if (!mockMode) {
    auth = await validateConfiguredTwitchAuth({ config, fetchImpl });
    logger.info('Twitch authentication validated', {
      userId: auth.userId, login: auth.login, expiresIn: auth.expiresIn, scopes: auth.scopes
    });
  } else {
    logger.info('Local Twitch CLI mock EventSub mode enabled', {
      eventSubUrl: config.eventSubUrl,
      broadcasterUserId: config.broadcasterUserId
    });
  }

  const activateFromTwitch = (request) => {
    const result = engine.activate(request);
    if (result.activated) {
      logger.info('Curse activated', {
        curse: request.curse, source: request.source, eventId: request.eventId,
        startedAt: result.effect.startedAt, expiresAt: result.effect.expiresAt
      });
    } else {
      logger.warn('Curse activation rejected', {
        curse: request.curse, source: request.source, eventId: request.eventId, reason: result.reason
      });
    }
    return result;
  };

  const handleChatMessage = createChatHandler({
    activateCurse: activateFromTwitch,
    onCommand: ({ messageId, username, command }) => {
      logger.info('Incoming Twitch chat command', { messageId, username, command });
    },
    onError: (error) => logger.error('Chat command processing failed', { message: error.message })
  });

  // Mock mode deliberately has no Twitch redemption API client or fulfillment path.
  // channel:manage:redemptions is intentionally not requested by this MVP.
  const redemptionService = mockMode ? null : createRedemptionService({
    clientId: config.clientId, accessToken: config.accessToken,
    broadcasterUserId: config.broadcasterUserId, apiBaseUrl: config.apiBaseUrl,
    fetchImpl, canManageRedemptions: false
  });
  const handleRedemption = createChannelPointsHandler({
    gravityRewardId: config.gravityRewardId,
    broadcasterUserId: config.broadcasterUserId,
    activateCurse: activateFromTwitch,
    redemptionService,
    onReceived: ({ redemptionId, rewardId, username }) => {
      logger.info('Gravity Curse Channel Points redemption received', { redemptionId, rewardId, username });
    },
    onProcessed: async (notification, result) => {
      logger.info('Channel Points redemption processed', {
        redemptionId: result.redemptionId, rewardId: result.rewardId,
        activated: result.activated, fulfilled: result.fulfillment?.fulfilled ?? false,
        fulfillmentReason: result.fulfillment?.reason
      });
      await onRedemption(notification, result);
    },
    onError: (error, context) => logger.error('Channel Points processing failed', {
      message: error.message, ...context
    })
  });

  const eventSub = createEventSubClient({
    config, fetchImpl, ...(WebSocketImpl ? { WebSocketImpl } : {}),
    onChatMessage: handleChatMessage, onRedemption: handleRedemption,
    onRevocation, onStatus: (status) => {
      if (status.state === 'connected' || status.state === 'welcomed') logger.info('EventSub status', status);
      else if (status.state === 'error' || status.state === 'closed') logger.warn('EventSub status', status);
      onStatus(status);
    },
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
  const unsubscribeEngineEvents = typeof engine.subscribeEvents === 'function'
    ? engine.subscribeEvents((event) => {
      if (event.type === 'expired') logger.info('Curse expired', {
        curse: event.effect.id, expiredAt: event.timestamp, state: event.snapshot.state
      });
    })
    : () => {};

  try {
    const session = await eventSub.start();
    logger.info('EventSub session established', { sessionId: session.sessionId });
    if (!mockMode) {
      validationTimer = setIntervalImpl(async () => {
        try {
          await validateConfiguredTwitchAuth({ config, fetchImpl });
          logger.info('Twitch access token hourly validation succeeded');
        } catch (error) {
          logger.error('Twitch access token invalid; stopping EventSub', { message: error.message });
          stop();
        }
      }, revalidationIntervalMs);
    }
    return Object.freeze({
      auth, sessionId: session.sessionId, engine, stop, eventSub,
      dispose() { unsubscribeEngineEvents(); stop(); }
    });
  } catch (error) {
    unsubscribeEngineEvents();
    stop();
    throw error;
  }
}
