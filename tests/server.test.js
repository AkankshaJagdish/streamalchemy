import { describe, expect, it, vi } from 'vitest';
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

  it('starts the real overlay server and serves health and browser assets', async () => {
    const engine = createCurseEngine();
    const app = await createApplication({
      env: {
        TWITCH_ENABLED: 'false',
        HOST: '127.0.0.1',
        OVERLAY_ALLOWED_ORIGINS: 'http://127.0.0.1'
      },
      engine
    });
    let address;
    try {
      address = await app.listen(0, '127.0.0.1');
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

      const script = await fetch(`${base}/overlay/overlay.js`);
      expect(script.status).toBe(200);
      expect(await script.text()).toContain('curse:state');
    } finally {
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
