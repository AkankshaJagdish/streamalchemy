import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createCurseEngine } from '../src/engine/curseEngine.js';
import { createChatHandler } from '../src/twitch/chatHandler.js';
import { createChannelPointsHandler } from '../src/twitch/channelPointsHandler.js';
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

describe('StreamAlchemy mocked full integration flows', () => {
  let engine;
  let overlay;
  let io;
  afterEach(() => {
    overlay?.close();
    overlay = null;
    engine?.shutdown();
    engine = null;
    vi.useRealTimers();
  });
  function setup() {
    vi.useFakeTimers({ now: 1_000 });
    engine = createCurseEngine();
    overlay = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => new MockIo()),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    io = overlay.io;
  }

  it('chat → Curse Engine → overlay broadcast → 30-second expiration reset', async () => {
    setup();
    const handler = createChatHandler({ activateCurse: (request) => engine.activate(request) });
    const result = await handler(chatEnvelope());
    expect(result.activated).toBe(true);
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

  it('Channel Points → same Curse Engine → overlay broadcast → expiration', async () => {
    setup();
    const handler = createChannelPointsHandler({
      gravityRewardId: 'gravity-reward-id',
      activateCurse: (request) => engine.activate(request)
    });
    const result = await handler(redemptionEnvelope());
    expect(result.activated).toBe(true);
    expect(engine.getActiveEffect()).toMatchObject({ startedAt: 1_000, expiresAt: 31_000 });
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
    const handler = createChannelPointsHandler({
      gravityRewardId: 'gravity-reward-id',
      activateCurse: (request) => engine.activate(request)
    });
    await expect(handler(redemptionEnvelope('redemption-2', 'other-reward')))
      .resolves.toMatchObject({ activated: false, reason: 'unrelated-reward' });
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

  it('overlay event payloads contain no Twitch credentials', () => {
    setup();
    engine.activate({ curse: 'gravity', source: 'twitch-chat' });
    const serialized = JSON.stringify(io.emitted);
    expect(serialized).not.toMatch(/accessToken|clientSecret|authorization|TWITCH_USER_ACCESS_TOKEN/i);
  });

  it('chat reports a rejected engine activation as rejected, not as success', async () => {
    const handler = createChatHandler({
      activateCurse: vi.fn().mockReturnValue({ activated: false, reason: 'already-active' })
    });
    await expect(handler(chatEnvelope('chat-already-active')))
      .resolves.toMatchObject({ handled: true, activated: false, reason: 'already-active' });
  });

  it('concurrent duplicate redemption cannot run activation twice', async () => {
    const activation = vi.fn();
    let finish;
    activation.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const handler = createChannelPointsHandler({ gravityRewardId: 'gravity-reward-id', activateCurse: activation });
    const first = handler(redemptionEnvelope());
    await Promise.resolve();
    const second = await handler(redemptionEnvelope());
    expect(second).toMatchObject({ duplicate: true, reason: 'duplicate-redemption' });
    finish({ activated: true });
    expect(await first).toMatchObject({ activated: true });
    expect(activation).toHaveBeenCalledOnce();
  });
});
