import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

export async function startApplicationServer({
  application,
  logger: appLogger = logger,
  processImpl = process
} = {}) {
  if (!application || typeof application.listen !== 'function' || typeof application.close !== 'function') {
    throw new TypeError('startApplicationServer requires an application lifecycle handle');
  }
  try {
    const address = await application.listen();
    appLogger.info('StreamAlchemy server listening', { address });
    const shutdown = () => { application.close(); processImpl.exitCode = 0; };
    processImpl.once('SIGINT', shutdown);
    processImpl.once('SIGTERM', shutdown);
    return address;
  } catch (error) {
    application.close();
    throw error;
  }
}

async function main() {
  const application = await createApplication();
  await startApplicationServer({ application, logger });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logger.error('StreamAlchemy startup failed', { message: error.message });
    process.exitCode = 1;
  });
}
