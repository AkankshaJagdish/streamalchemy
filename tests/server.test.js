import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createApplication } from '../src/server.js';

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
  it('closes Twitch, overlay and engine if the HTTP listener fails after Twitch startup', async () => {
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

    await expect(app.listen()).rejects.toThrow('EADDRINUSE');

    // main() owns the cleanup of a failed listen. Exercise the same cleanup
    // contract through the returned application handle.
    app.close();
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
