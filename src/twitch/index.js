import { loadConfig } from '../config.js';
import { validateConfiguredTwitchAuth } from './auth.js';
import { createEventSubClient } from './eventsub.js';
import { createChatHandler } from './chatHandler.js';
import { logger as defaultLogger } from '../utils/logger.js';

/**
 * Startup boundary for Stage 1 + Stage 2:
 * 1) parse required environment,
 * 2) validate broadcaster User Access Token and scopes,
 * 3) connect EventSub and register subscriptions,
 * 4) route only chat-message notifications to Stage 2's parser adapter.
 *
 * The activation callback is deliberately injected; Stage 3 will supply the
 * Curse Engine. This module does not implement curse activation itself.
 */
export async function startTwitchIntegration({
  env = process.env,
  fetchImpl = fetch,
  WebSocketImpl,
  activateCurse = async () => {},
  onRedemption = async () => {},
  onRevocation = () => {},
  onStatus = () => {},
  logger = defaultLogger
} = {}) {
  const { twitch: config } = loadConfig(env);
  const auth = await validateConfiguredTwitchAuth({ config, fetchImpl });
  logger.info('Twitch token validated', {
    userId: auth.userId,
    login: auth.login,
    expiresIn: auth.expiresIn,
    scopes: auth.scopes
  });

  const handleChatMessage = createChatHandler({
    activateCurse,
    onError: (error) => logger.error('Chat command processing failed', { message: error.message })
  });

  const eventSub = createEventSubClient({
    config,
    fetchImpl,
    ...(WebSocketImpl ? { WebSocketImpl } : {}),
    onChatMessage: handleChatMessage,
    onRedemption,
    onRevocation,
    onStatus,
    logger
  });

  try {
    const session = await eventSub.start();
    return Object.freeze({
      auth,
      sessionId: session.sessionId,
      stop: () => eventSub.stop(),
      eventSub
    });
  } catch (error) {
    eventSub.stop();
    throw error;
  }
}
