import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { io as createSocketClient } from 'socket.io-client';
import { createOverlayServer } from '../src/websocket/overlayServer.js';
import { OVERLAY_EVENTS } from '../src/websocket/overlayEvents.js';

class MockIo extends EventEmitter {
  constructor() { super(); this.emitted = []; }
  emit(event, ...args) {
    if (event !== 'connection' && event !== 'disconnect') this.emitted.push({ event, payload: args[0] });
    return super.emit(event, ...args);
  }
  connect(socket) { super.emit('connection', socket); }
  close() {}
}
class MockHttpServer extends EventEmitter {
  listen(_port, _host, callback) { callback(); }
  address() { return { port: 3000 }; }
}
function makeEngine(snapshot = { state: 'IDLE', activeEffect: null }) {
  let current = snapshot;
  const stateListeners = new Set();
  const eventListeners = new Set();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      stateListeners.add(listener);
      listener(current);
      return () => stateListeners.delete(listener);
    },
    subscribeEvents(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    setSnapshot(next) {
      const previous = current;
      current = next;
      for (const listener of [...stateListeners]) listener(current);
      if (previous.state !== 'ACTIVE' && next.state === 'ACTIVE') {
        const event = { type: 'activated', effect: next.activeEffect, snapshot: next, timestamp: next.activeEffect.startedAt };
        for (const listener of [...eventListeners]) listener(event);
      } else if (previous.state === 'ACTIVE' && next.state !== 'ACTIVE') {
        const event = { type: 'expired', effect: previous.activeEffect, snapshot: next, timestamp: Date.now() };
        for (const listener of [...eventListeners]) listener(event);
      }
    }
  };
}
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('overlay server', () => {
  let server;
  afterEach(async () => {
    const currentServer = server;
    server = null;
    if (currentServer) {
      const closed = currentServer.httpServer?.listening
        ? new Promise((resolve) => currentServer.httpServer.once('close', resolve))
        : Promise.resolve();
      currentServer.close();
      await closed;
    }
    vi.restoreAllMocks();
  });

  it('sends current state immediately when an overlay connects', () => {
    const engine = makeEngine();
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    const socket = { id: 'overlay-1', emit: vi.fn(), on: vi.fn() };
    server.io.connect(socket);
    expect(socket.emit).toHaveBeenCalledWith(OVERLAY_EVENTS.CURSE_STATE, { state: 'idle', effect: null });
  });

  it('synchronises an active effect with its original expiry time on connect', () => {
    const effect = { id: 'gravity', name: 'Gravity Curse', startedAt: 1000, expiresAt: 31000, duration: 30000 };
    const engine = makeEngine({ state: 'ACTIVE', activeEffect: effect });
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    const socket = { id: 'overlay-2', emit: vi.fn(), on: vi.fn() };
    server.io.connect(socket);
    expect(socket.emit).toHaveBeenCalledWith(OVERLAY_EVENTS.CURSE_STATE, {
      state: 'active', effect: {
        id: 'gravity', name: 'Gravity Curse',
        startedAt: 1000, expiresAt: 31000, duration: 30000
      }
    });
  });

  it('broadcasts activation and current state when the engine becomes active', () => {
    const engine = makeEngine();
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    const effect = { id: 'gravity', name: 'Gravity Curse', startedAt: 1000, expiresAt: 31000, duration: 30000 };
    engine.setSnapshot({ state: 'ACTIVE', activeEffect: effect });
    expect(server.io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_ACTIVATED, payload: effect
    });
    expect(server.io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_STATE, payload: {
        state: 'active', effect: { ...effect }
      }
    });
  });

  it('broadcasts expiration and idle state when the engine returns to idle', () => {
    vi.spyOn(Date, 'now').mockReturnValue(31000);
    const effect = { id: 'gravity', name: 'Gravity Curse', startedAt: 1000, expiresAt: 31000, duration: 30000 };
    const engine = makeEngine({ state: 'ACTIVE', activeEffect: effect });
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    engine.setSnapshot({ state: 'IDLE', activeEffect: null });
    expect(server.io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_EXPIRED,
      payload: { id: 'gravity', expiredAt: 31000, state: 'idle' }
    });
    expect(server.io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_STATE, payload: { state: 'idle', effect: null }
    });
    expect(server.io.emitted.filter((entry) => entry.event === OVERLAY_EVENTS.CURSE_STATE)).toHaveLength(2);
  });

  it('restores state after overlay reconnection without resetting timestamps', () => {
    const effect = { id: 'gravity', name: 'Gravity Curse', startedAt: 1000, expiresAt: 31000, duration: 30000 };
    const engine = makeEngine({ state: 'ACTIVE', activeEffect: effect });
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    const first = { id: 'first', emit: vi.fn(), on: vi.fn() };
    const second = { id: 'second', emit: vi.fn(), on: vi.fn() };
    server.io.connect(first);
    server.io.connect(second);
    expect(first.emit).toHaveBeenCalledWith(OVERLAY_EVENTS.CURSE_STATE, expect.objectContaining({
      state: 'active', effect: expect.objectContaining({ expiresAt: 31000 })
    }));
    expect(second.emit).toHaveBeenCalledWith(OVERLAY_EVENTS.CURSE_STATE, expect.objectContaining({
      state: 'active', effect: expect.objectContaining({ expiresAt: 31000 })
    }));
  });

  it('never includes Twitch credentials in public event payloads', () => {
    const engine = makeEngine();
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    const sensitiveEffect = {
      id: 'gravity', name: 'Gravity Curse', startedAt: 1,
      expiresAt: 30001, duration: 30000,
      accessToken: 'should-not-leak', clientSecret: 'should-not-leak'
    };
    engine.setSnapshot({ state: 'ACTIVE', activeEffect: sensitiveEffect });
    const encoded = JSON.stringify(server.io.emitted);
    expect(encoded).not.toContain('should-not-leak');
    expect(encoded).not.toContain('accessToken');
    expect(encoded).not.toContain('clientSecret');
  });

  it('does not expose an activation command on the overlay socket', () => {
    const engine = makeEngine();
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    const socket = { id: 'overlay-3', emit: vi.fn(), on: vi.fn() };
    server.io.connect(socket);
    expect(socket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(socket.on).not.toHaveBeenCalledWith('activate', expect.any(Function));
  });
  it('serves health, the overlay page, and its referenced assets over real HTTP', async () => {
    server = createOverlayServer({ engine: makeEngine(), logger: mockLogger });
    const address = await server.listen(0, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toMatch(/application\/json/);
    expect(await health.json()).toEqual({ ok: true });

    const overlayResponse = await fetch(`${baseUrl}/overlay/`);
    expect(overlayResponse.status).toBe(200);
    expect(overlayResponse.headers.get('content-type')).toMatch(/text\/html/);
    const html = await overlayResponse.text();
    expect(html).toContain('StreamAlchemy — Gravity Curse Overlay');
    expect(html).toContain('id="curse-countdown"');
    expect(html).toContain('href="/overlay/style.css"');
    expect(html).toContain('href="/overlay/animations.css"');
    expect(html).toContain('src="/overlay/overlay.js"');

    const referencedAssets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => path.startsWith('/overlay/') || path === '/socket.io/socket.io.js');
    for (const assetPath of referencedAssets) {
      const response = await fetch(new URL(assetPath, baseUrl));
      expect(response.status, `${assetPath} should be served`).toBe(200);
      expect(response.headers.get('content-type'), `${assetPath} should have a JavaScript or CSS content type`)
        .toMatch(/(?:javascript|text\/css)/);
      const body = await response.text();
      expect(body.length, `${assetPath} should not be empty`).toBeGreaterThan(0);
      if (assetPath.endsWith('/style.css')) expect(body).toContain('background: transparent');
      if (assetPath.endsWith('/animations.css')) expect(body).toContain('@keyframes rise');
      if (assetPath.endsWith('/overlay.js')) expect(body).toContain("socket.on('curse:state'");
    }
    expect(referencedAssets).toEqual(expect.arrayContaining([
      '/overlay/style.css', '/overlay/animations.css',
      '/overlay/overlay.js', '/socket.io/socket.io.js'
    ]));

    const withoutSlash = await fetch(`${baseUrl}/overlay`, { redirect: 'manual' });
    if ([301, 308].includes(withoutSlash.status)) {
      const redirectTarget = new URL(withoutSlash.headers.get('location'), baseUrl);
      expect(redirectTarget.pathname).toBe('/overlay/');
      const redirectedPage = await fetch(redirectTarget);
      expect(redirectedPage.status).toBe(200);
      expect(await redirectedPage.text()).toContain('StreamAlchemy — Gravity Curse Overlay');
    } else {
      expect(withoutSlash.status).toBe(200);
      expect(withoutSlash.headers.get('content-type')).toMatch(/text\\/html/);
      expect(await withoutSlash.text()).toContain('StreamAlchemy — Gravity Curse Overlay');
    }

    const missingAsset = await fetch(`${baseUrl}/overlay/missing-regression-asset.js`);
    expect(missingAsset.status).toBe(404);
    expect(await missingAsset.text()).not.toContain('StreamAlchemy — Gravity Curse Overlay');
  });

  it('keeps a real Socket.IO connection and sends the current initial state', async () => {
    const effect = {
      id: 'gravity', name: 'Gravity Curse',
      startedAt: 1000, expiresAt: 31000, duration: 30000
    };
    server = createOverlayServer({
      engine: makeEngine({ state: 'ACTIVE', activeEffect: effect }),
      logger: mockLogger
    });
    const address = await server.listen(0, '127.0.0.1');
    const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
      autoConnect: false,
      reconnection: false,
      timeout: 3000,
      transports: ['websocket']
    });

    try {
      const initialState = new Promise((resolve, reject) => {
        client.once(OVERLAY_EVENTS.CURSE_STATE, resolve);
        client.once('connect_error', reject);
      });
      client.connect();
      expect(await initialState).toEqual({
        state: 'active',
        effect: {
          id: 'gravity', name: 'Gravity Curse',
          startedAt: 1000, expiresAt: 31000, duration: 30000
        }
      });
      expect(client.connected).toBe(true);
    } finally {
      client.disconnect();
    }
  });

});
