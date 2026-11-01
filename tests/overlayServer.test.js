import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createOverlayServer } from '../src/websocket/overlayServer.js';
import { OVERLAY_EVENTS } from '../src/websocket/overlayEvents.js';

class MockIo extends EventEmitter {
  constructor() {
    super();
    this.emitted = [];
  }
  emit(event, ...args) {
    if (event !== 'connection' && event !== 'disconnect') {
      this.emitted.push({ event, payload: args[0] });
    }
    return super.emit(event, ...args);
  }
  connect(socket) {
    super.emit('connection', socket);
  }
  close() {}
}

class MockHttpServer extends EventEmitter {
  listen(_port, _host, callback) { callback(); }
  address() { return { port: 3000 }; }
}

function makeEngine(snapshot = { state: 'IDLE', activeEffect: null }) {
  let current = snapshot;
  const listeners = new Set();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    }
  };
}

const mockLogger = { info: vi.fn(), error: vi.fn() };

describe('overlay server', () => {
  let server;
  afterEach(() => {
    server?.close();
    server = null;
    vi.clearAllMocks();
  });

  it('sends current state immediately when an overlay connects', () => {
    const engine = makeEngine();
    const SocketIOServerImpl = vi.fn(() => new MockIo());
    server = createOverlayServer({
      engine,
      httpServer: new MockHttpServer(),
      SocketIOServerImpl,
      logger: mockLogger
    });
    const socket = { id: 'overlay-1', emit: vi.fn(), on: vi.fn() };
    server.io.connect(socket);
    expect(socket.emit).toHaveBeenCalledWith(OVERLAY_EVENTS.CURSE_STATE, {
      state: 'idle', effect: null
    });
  });

  it('synchronises an active effect with its original expiry time on connect', () => {
    const effect = {
      id: 'gravity', name: 'Gravity Curse',
      startedAt: 1000, expiresAt: 31000, duration: 30000
    };
    const engine = makeEngine({ state: 'ACTIVE', activeEffect: effect });
    server = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()), logger: mockLogger
    });
    const socket = { id: 'overlay-2', emit: vi.fn(), on: vi.fn() };
    server.io.connect(socket);
    expect(socket.emit).toHaveBeenCalledWith(OVERLAY_EVENTS.CURSE_STATE, {
      state: 'active',
      effect: {
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
    const effect = {
      id: 'gravity', name: 'Gravity Curse',
      startedAt: 1000, expiresAt: 31000, duration: 30000
    };
    engine.setSnapshot({ state: 'ACTIVE', activeEffect: effect });
    expect(server.io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_ACTIVATED,
      payload: effect
    });
    expect(server.io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_STATE,
      payload: {
        state: 'active',
        effect: {
          id: 'gravity', name: 'Gravity Curse',
          startedAt: 1000, expiresAt: 31000, duration: 30000
        }
      }
    });
  });

  it('broadcasts expiration and idle state when the engine returns to idle', () => {
    vi.spyOn(Date, 'now').mockReturnValue(31000);
    const effect = {
      id: 'gravity', name: 'Gravity Curse',
      startedAt: 1000, expiresAt: 31000, duration: 30000
    };
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
    expect(server.io.emitted.at(-1)).toEqual({
      event: OVERLAY_EVENTS.CURSE_STATE,
      payload: { state: 'idle', effect: null }
    });
    vi.restoreAllMocks();
  });

  it('restores state after overlay reconnection without resetting timestamps', () => {
    const effect = {
      id: 'gravity', name: 'Gravity Curse',
      startedAt: 1000, expiresAt: 31000, duration: 30000
    };
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
    const effect = {
      id: 'gravity', name: 'Gravity Curse',
      startedAt: 1, expiresAt: 30001, duration: 30000,
      accessToken: 'should-not-leak', clientSecret: 'should-not-leak'
    };
    engine.setSnapshot({ state: 'ACTIVE', activeEffect: effect });
    const serialized = JSON.stringify(server.io.emitted);
    expect(serialized).not.toContain('should-not-leak');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('clientSecret');
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
});
