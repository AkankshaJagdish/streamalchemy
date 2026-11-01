import { loadConfig } from '../config.js';
import { validateConfiguredTwitchAuth } from './auth.js';
import { createEventSubClient } from './eventsub.js';
import { createChatHandler } from './chatHandler.js';
import { logger as defaultLogger } from '../utils/logger.js';

const TOKEN_REVALIDATION_INTERVAL_MS = 60 * 60 * 1000;

export async function startTwitchIntegration({
  env = process.env,
  fetchImpl = fetch,
  WebSocketImpl,
  activateCurse = async () => {},
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

  let validationTimer = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (validationTimer) clearIntervalImpl(validationTimer);
    eventSub.stop();
  };

  try {
    const session = await eventSub.start();

    // Twitch requires OAuth sessions to be validated at startup and hourly.
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
      stop,
      eventSub
    });
  } catch (error) {
    stop();
    throw error;
  }
}
