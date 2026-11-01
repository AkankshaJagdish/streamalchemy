import { describe, expect, it, vi } from 'vitest';
import { io as createSocketClient } from 'socket.io-client';
import { createApplication, startApplicationServer } from '../src/server.js';
import { createCurseEngine } from '../src/engine/curseEngine.js';

function makeEngine() {
  return {
    shutdown: vi.fn(),
    activate: vi.fn(),
    getSnapshot: vi.fn(() => ({ state: 'IDLE', activeEffect: null })),
    subscribe: vi.fn(() => vi.fn()),
    subscribeEvents: vi.fn(() => vi.fn())
  };
}

function connectAndReadState(socket) {
  const connected = new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const state = new Promise((resolve, reject) => {
    socket.once('curse:state', resolve);
    socket.once('connect_error', reject);
  });
  socket.connect();
  return Promise.all([connected, state]).then(([, snapshot]) => snapshot);
}

describe('application lifecycle', () => {
  it('closes Twitch and overlay if the HTTP listener fails after Twitch startup', async () => {
    const engine = makeEngine();
    const twitch = { dispose: vi.fn(), stop: vi.fn() };
    const overlay = {
      listen: vi.fn().mockRejectedValue(new Error('EADDRINUSE')),
      close: vi.fn()
    };
    const app = await createApplication({
      env: { TWITCH_ENABLED: 'true', PORT: '3000', HOST: '127.0.0.1' },
      engine,
      startTwitch: vi.fn().mockResolvedValue(twitch),
      overlayFactory: vi.fn(() => overlay),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });

    await expect(startApplicationServer({
      application: app,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      processImpl: { once: vi.fn(), exitCode: undefined }
    })).rejects.toThrow('EADDRINUSE');
    expect(twitch.dispose).toHaveBeenCalledOnce();
    expect(overlay.close).toHaveBeenCalledOnce();
    expect(engine.shutdown).not.toHaveBeenCalled();
  });

  it('closes the overlay and engine if Twitch initialization fails', async () => {
    const engine = makeEngine();
    const overlay = { listen: vi.fn(), close: vi.fn() };
    await expect(createApplication({
      env: { TWITCH_ENABLED: 'true' },
      engine,
      startTwitch: vi.fn().mockRejectedValue(new Error('Twitch auth rejected')),
      overlayFactory: vi.fn(() => overlay),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })).rejects.toThrow('Twitch auth rejected');

    expect(overlay.close).toHaveBeenCalledOnce();
    expect(engine.shutdown).toHaveBeenCalledOnce();
  });

  it('binds to 0.0.0.0, respects PORT, serves health/assets, and communicates over WebSocket and polling', async () => {
    const engine = createCurseEngine();
    const app = await createApplication({
      env: {
        TWITCH_ENABLED: 'false',
        PORT: '0',
        HOST: '0.0.0.0',
        OVERLAY_ALLOWED_ORIGINS: 'http://127.0.0.1'
      },
      engine
    });
    let websocketClient;
    let pollingClient;
    try {
      const address = await app.listen();
      expect(address.address).toBe('0.0.0.0');
      expect(address.port).toBeGreaterThan(0);
      const base = `http://127.0.0.1:${address.port}`;

      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ ok: true });

      const overlay = await fetch(`${base}/overlay/`);
      expect(overlay.status).toBe(200);
      const html = await overlay.text();
      expect(html).toContain('StreamAlchemy — Gravity Curse Overlay');
      expect(html).toContain('/socket.io/socket.io.js');
      expect(html).toContain('/overlay/overlay.js');

      for (const asset of ['style.css', 'animations.css', 'overlay.js']) {
        const response = await fetch(`${base}/overlay/${asset}`);
        expect(response.status).toBe(200);
      }

      websocketClient = createSocketClient(base, {
        autoConnect: false, reconnection: false, timeout: 3000, transports: ['websocket']
      });
      const initialState = await connectAndReadState(websocketClient);
      expect(initialState).toEqual({ state: 'idle', effect: null });

      const activation = new Promise((resolve) => websocketClient.once('curse:activated', resolve));
      const result = engine.activate({ curse: 'gravity', source: 'twitch-chat' });
      expect(result.activated).toBe(true);
      await expect(activation).resolves.toMatchObject({
        id: 'gravity', name: 'Gravity Curse', expiresAt: result.effect.expiresAt
      });

      pollingClient = createSocketClient(base, {
        autoConnect: false, reconnection: false, timeout: 3000, transports: ['polling']
      });
      const restoredState = await connectAndReadState(pollingClient);
      expect(restoredState).toMatchObject({
        state: 'active',
        effect: {
          id: 'gravity',
          expiresAt: result.effect.expiresAt
        }
      });
    } finally {
      websocketClient?.disconnect();
      pollingClient?.disconnect();
      app.close();
    }
  });

  it('shuts down the engine in overlay-only mode', () => {
    const engine = makeEngine();
    const overlay = { listen: vi.fn(), close: vi.fn() };
    return createApplication({
      env: { TWITCH_ENABLED: 'false' },
      engine,
      overlayFactory: vi.fn(() => overlay),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    }).then((app) => {
      app.close();
      expect(overlay.close).toHaveBeenCalledOnce();
      expect(engine.shutdown).toHaveBeenCalledOnce();
    });
  });
});
