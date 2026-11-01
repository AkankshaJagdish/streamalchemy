import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
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
  afterEach(() => {
    server?.close();
    server = null;
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
});
