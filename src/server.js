import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createOverlayServer } from './websocket/overlayServer.js';
import { createCurseEngine } from './engine/curseEngine.js';
import { startTwitchIntegration } from './twitch/index.js';
import { logger } from './utils/logger.js';

export async function createApplication({
  env = process.env, engine = createCurseEngine({ logger }),
  startTwitch = startTwitchIntegration, overlayFactory = createOverlayServer,
  logger: appLogger = logger
} = {}) {
  const overlay = overlayFactory({ engine, allowedOrigins: env.OVERLAY_ALLOWED_ORIGINS, logger: appLogger });
  let twitch = null;
  if (String(env.TWITCH_ENABLED ?? 'true').toLowerCase() !== 'false') {
    try { twitch = await startTwitch({ env, engine, logger: appLogger }); }
    catch (error) {
      overlay.close();
      engine.shutdown();
      throw error;
    }
  }
  return Object.freeze({
    engine, overlay, twitch,
    async listen(port = Number(env.PORT ?? 3000), host = env.HOST ?? '0.0.0.0') {
      return overlay.listen(port, host);
    },
    close() {
      if (typeof twitch?.dispose === 'function') twitch.dispose();
      else twitch?.stop?.();
      overlay.close();
      if (!twitch) engine.shutdown();
    }
  });
}

async function main() {
  const application = await createApplication();
  try {
    const address = await application.listen();
    logger.info('StreamAlchemy server listening', { address });
    const shutdown = () => { application.close(); process.exitCode = 0; };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    application.close();
    throw error;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(process.argv[1])) {
  main().catch((error) => {
    logger.error('StreamAlchemy startup failed', { message: error.message });
    process.exitCode = 1;
  });
}
