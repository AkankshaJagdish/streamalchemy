import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createCurseEngine } from '../src/engine/curseEngine.js';
import { createChatHandler } from '../src/twitch/chatHandler.js';
import { createChannelPointsHandler } from '../src/twitch/channelPointsHandler.js';
import { createEventSubClient } from '../src/twitch/eventsub.js';
import { createOverlayServer } from '../src/websocket/overlayServer.js';
import { OVERLAY_EVENTS } from '../src/websocket/overlayEvents.js';

class MockIo extends EventEmitter {
  constructor() { super(); this.emitted = []; }
  emit(name, ...args) {
    if (name !== 'connection' && name !== 'disconnect') this.emitted.push({ event: name, payload: args[0] });
    return super.emit(name, ...args);
  }
  close() {}
  connect(socket) { super.emit('connection', socket); }
}
class MockHttpServer extends EventEmitter {
  listen(_port, _host, callback) { callback(); }
  address() { return { port: 3000 }; }
}
class MockEventSubSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockEventSubSocket.OPEN;
    MockEventSubSocket.instances.push(this);
  }
  close(code = 1000, reason = '') {
    this.readyState = MockEventSubSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }
  sendFrame(message) { this.emit('message', Buffer.from(JSON.stringify(message))); }
}
const welcome = (id) => ({
  metadata: { message_type: 'session_welcome' },
  payload: { session: { id, status: 'connected', keepalive_timeout_seconds: 30 } }
});
const chatEnvelope = (messageId = 'chat-1') => ({
  metadata: { message_type: 'notification', subscription_type: 'channel.chat.message' },
  payload: { event: {
    message_id: messageId, chatter_user_id: 'viewer-id', chatter_user_name: 'viewer',
    message: { text: '!curse gravity' }
  } }
});
const redemptionEnvelope = (redemptionId = 'redemption-1', rewardId = 'gravity-reward-id') => ({
  metadata: { message_type: 'notification', subscription_type: 'channel.channel_points_custom_reward_redemption.add' },
  payload: { event: {
    id: redemptionId, user_id: 'viewer-id', user_login: 'viewer',
    reward: { id: rewardId, title: 'Gravity Curse' }
  } }
});
const apiResponse = () => ({
  ok: true, status: 202,
  json: async () => ({ data: [{ id: 'sub-id' }] })
});

describe('StreamAlchemy mocked full integration flows', () => {
  let engine;
  let overlay;
  let eventSub;
  let io;
  afterEach(() => {
    eventSub?.stop();
    overlay?.close();
    engine?.shutdown();
    eventSub = null;
    overlay = null;
    engine = null;
    vi.useRealTimers();
    MockEventSubSocket.instances = [];
  });
  function setup() {
    vi.useFakeTimers({ now: 1_000 });
    engine = createCurseEngine();
    overlay = createOverlayServer({
      engine,
      httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    io = overlay.io;
  }
  async function connectEventSub({ onChatMessage, onRedemption }) {
    const fetchImpl = vi.fn().mockResolvedValue(apiResponse());
    eventSub = createEventSubClient({
      config: {
        clientId: 'test-client',
        accessToken: 'mock-access-token',
        broadcasterUserId: '100',
        botUserId: '100'
      },
      fetchImpl,
      WebSocketImpl: MockEventSubSocket,
      onChatMessage,
      onRedemption,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    const started = eventSub.start();
    MockEventSubSocket.instances[0].sendFrame(welcome('mock-session'));
    await started;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    return MockEventSubSocket.instances[0];
  }

  it('chat → EventSub → parser/handler → Curse Engine → overlay → expiration', async () => {
    setup();
    const chat = createChatHandler({ activateCurse: (request) => engine.activate(request) });
    const socket = await connectEventSub({ onChatMessage: chat });
    socket.sendFrame(chatEnvelope());

    expect(engine.getSnapshot()).toMatchObject({
      state: 'ACTIVE',
      activeEffect: {
        id: 'gravity', name: 'Gravity Curse', startedAt: 1_000,
        expiresAt: 31_000, duration: 30_000
      }
    });
    expect(io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_ACTIVATED,
      payload: { id: 'gravity', name: 'Gravity Curse', startedAt: 1_000, expiresAt: 31_000, duration: 30_000 }
    });
    vi.advanceTimersByTime(29_999);
    expect(engine.getState()).toBe('ACTIVE');
    vi.advanceTimersByTime(1);
    expect(engine.getState()).toBe('IDLE');
    expect(io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_EXPIRED,
      payload: { id: 'gravity', expiredAt: 31_000, state: 'idle' }
    });
    expect(io.emitted.at(-1)).toEqual({
      event: OVERLAY_EVENTS.CURSE_STATE, payload: { state: 'idle', effect: null }
    });
  });

  it('Channel Points → EventSub → reward-ID handler → same Curse Engine → overlay → expiration', async () => {
    setup();
    const channelPoints = createChannelPointsHandler({
      gravityRewardId: 'gravity-reward-id',
      activateCurse: (request) => engine.activate(request)
    });
    const socket = await connectEventSub({ onRedemption: channelPoints });
    socket.sendFrame(redemptionEnvelope());

    expect(engine.getActiveEffect()).toMatchObject({
      id: 'gravity', startedAt: 1_000, expiresAt: 31_000, duration: 30_000
    });
    expect(io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_ACTIVATED,
      payload: { id: 'gravity', name: 'Gravity Curse', startedAt: 1_000, expiresAt: 31_000, duration: 30_000 }
    });
    vi.advanceTimersByTime(30_000);
    expect(engine.getState()).toBe('IDLE');
    expect(io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_EXPIRED,
      payload: { id: 'gravity', expiredAt: 31_000, state: 'idle' }
    });
  });

  it('unrelated reward ID cannot activate gravity', async () => {
    setup();
    const channelPoints = createChannelPointsHandler({
      gravityRewardId: 'gravity-reward-id',
      activateCurse: (request) => engine.activate(request)
    });
    const socket = await connectEventSub({ onRedemption: channelPoints });
    socket.sendFrame(redemptionEnvelope('redemption-2', 'other-reward'));
    expect(engine.getState()).toBe('IDLE');
    expect(io.emitted.some((entry) => entry.event === OVERLAY_EVENTS.CURSE_ACTIVATED)).toBe(false);
  });

  it('overlay reconnect restores active state with original expiresAt', async () => {
    setup();
    engine.activate({ curse: 'gravity', source: 'twitch-chat' });
    vi.advanceTimersByTime(12_000);
    const socket = { id: 'overlay-reconnected', emit: vi.fn(), on: vi.fn() };
    io.connect(socket);
    expect(socket.emit).toHaveBeenCalledWith(OVERLAY_EVENTS.CURSE_STATE, {
      state: 'active',
      effect: { id: 'gravity', name: 'Gravity Curse', startedAt: 1_000, expiresAt: 31_000, duration: 30_000 }
    });
    vi.advanceTimersByTime(18_000);
    expect(engine.getState()).toBe('IDLE');
  });

  it('overlay payloads contain no Twitch credentials', () => {
    setup();
    engine.activate({ curse: 'gravity', source: 'twitch-chat' });
    const encoded = JSON.stringify(io.emitted);
    expect(encoded).not.toMatch(/accessToken|clientSecret|authorization|TWITCH_USER_ACCESS_TOKEN/i);
  });

  it('chat reports a rejected engine activation as rejected, not as success', async () => {
    const handler = createChatHandler({
      activateCurse: vi.fn().mockReturnValue({ activated: false, reason: 'already-active' })
    });
    await expect(handler(chatEnvelope('chat-already-active')))
      .resolves.toMatchObject({ handled: true, activated: false, reason: 'already-active' });
  });

  it('concurrent duplicate redemption cannot invoke activation twice', async () => {
    let finish;
    const activation = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const handler = createChannelPointsHandler({
      gravityRewardId: 'gravity-reward-id', activateCurse: activation
    });
    const first = handler(redemptionEnvelope());
    await Promise.resolve();
    const second = await handler(redemptionEnvelope());
    expect(second).toMatchObject({ duplicate: true, reason: 'duplicate-redemption' });
    finish({ activated: true });
    expect(await first).toMatchObject({ activated: true });
    expect(activation).toHaveBeenCalledOnce();
  });
});
