import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { OVERLAY_EVENTS, createActivationPayload, createExpirationPayload, createStatePayload } from './overlayEvents.js';

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5173', 'http://127.0.0.1:5173'
]);
function normalizeOrigins(origins) {
  if (Array.isArray(origins)) return origins;
  if (typeof origins === 'string' && origins.trim()) return origins.split(',').map((origin) => origin.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS];
}
export function createOverlayServer({
  engine, app = express(), httpServer = createServer(app),
  allowedOrigins = process.env.OVERLAY_ALLOWED_ORIGINS,
  SocketIOServerImpl = SocketIOServer, logger = console
} = {}) {
  if (!engine || typeof engine.getSnapshot !== 'function' || typeof engine.subscribe !== 'function') {
    throw new TypeError('overlay server requires an observable Curse Engine');
  }
  const origins = normalizeOrigins(allowedOrigins);
  app.disable('x-powered-by');
  const overlayDirectory = fileURLToPath(new URL('../../public/overlay/', import.meta.url));
  const publicDirectory = fileURLToPath(new URL('../../public/', import.meta.url));
  app.use('/overlay', express.static(overlayDirectory, {
    dotfiles: 'deny', index: 'index.html'
  }));
  app.use(express.static(publicDirectory, {
    dotfiles: 'deny', index: 'index.html', fallthrough: true
  }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const io = new SocketIOServerImpl(httpServer, {
    cors: { origin: origins, methods: ['GET', 'POST'], credentials: false },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || origins.includes(origin));
    }
  });
  function broadcastState(snapshot = engine.getSnapshot()) {
    io.emit(OVERLAY_EVENTS.CURSE_STATE, createStatePayload(snapshot));
  }
  io.on('connection', (socket) => {
    socket.emit(OVERLAY_EVENTS.CURSE_STATE, createStatePayload(engine.getSnapshot()));
    logger.info?.('Overlay client connected', { socketId: socket.id });
    socket.on('disconnect', (reason) => logger.info?.('Overlay client disconnected', { socketId: socket.id, reason }));
  });
  const unsubscribeState = engine.subscribe((snapshot) => broadcastState(snapshot));
  const unsubscribeEvents = typeof engine.subscribeEvents === 'function'
    ? engine.subscribeEvents((event) => {
      if (event.type === 'activated') io.emit(OVERLAY_EVENTS.CURSE_ACTIVATED, createActivationPayload(event.effect));
      else if (event.type === 'expired') {
        io.emit(OVERLAY_EVENTS.CURSE_EXPIRED, createExpirationPayload(event.effect, event.timestamp));
      }
    })
    : () => {};
  function close() { unsubscribeState(); unsubscribeEvents(); io.close(); }
  return Object.freeze({
    app, httpServer, io, close,
    listen(port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? '0.0.0.0') {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve(httpServer.address());
        });
      });
    },
    broadcastState, allowedOrigins: Object.freeze(origins)
  });
}
