import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createEventSubClient, parseEventSubMessage } from '../src/twitch/eventsub.js';

class MockSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockSocket.OPEN;
    MockSocket.instances.push(this);
  }
  close(code = 1000, reason = '') {
    this.readyState = MockSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  }
  sendFrame(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const welcome = (id) => ({
  metadata: { message_type: 'session_welcome' },
  payload: { session: { id, status: 'connected', keepalive_timeout_seconds: 30, reconnect_url: null } }
});
const keepalive = () => ({ metadata: { message_type: 'session_keepalive' }, payload: {} });

describe('EventSub WebSocket client', () => {
  it('parses valid frames and rejects malformed frames', () => {
    expect(parseEventSubMessage(JSON.stringify(keepalive())).metadata.message_type).toBe('session_keepalive');
    expect(() => parseEventSubMessage('bad-json')).toThrow();
    expect(() => parseEventSubMessage('{}')).toThrow(/message_type/);
  });

  it('handles welcome, registers both subscriptions and keepalive', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 202, json: async () => ({ data: [{ id: 'sub-id' }] })
    });
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100', botUserId: '100' },
      fetchImpl,
      WebSocketImpl: MockSocket
    });
    const started = client.start();
    const socket = MockSocket.instances[0];
    socket.emit('open');
    socket.sendFrame(welcome('session-abc'));
    await started;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies.map((b) => b.type)).toEqual([
      'channel.chat.message',
      'channel.channel_points_custom_reward_redemption.add'
    ]);
    socket.sendFrame(keepalive());
    client.stop();
  });

  it('registers only the chat subscription in chat-only production mode', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 202, json: async () => ({ data: [{ id: 'chat-sub-id' }] })
    });
    const client = createEventSubClient({
      config: {
        clientId: 'client',
        accessToken: 'token',
        broadcasterUserId: '100',
        botUserId: '100',
        channelPointsEnabled: false
      },
      fetchImpl,
      WebSocketImpl: MockSocket
    });
    const started = client.start();
    MockSocket.instances[0].sendFrame(welcome('session-chat-only'));
    await started;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).type).toBe('channel.chat.message');
    client.stop();
  });

  it('routes notifications to the matching callback and handles revocation', async () => {
    MockSocket.instances = [];
    const onChatMessage = vi.fn();
    const onRedemption = vi.fn();
    const onRevocation = vi.fn();
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100' },
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) }),
      WebSocketImpl: MockSocket,
      onChatMessage,
      onRedemption,
      onRevocation
    });
    const started = client.start();
    MockSocket.instances[0].sendFrame(welcome('s1'));
    await started;
    MockSocket.instances[0].sendFrame({
      metadata: { message_type: 'notification', subscription_type: 'channel.chat.message' },
      payload: { event: { message: { text: '!curse gravity' } } }
    });
    MockSocket.instances[0].sendFrame({
      metadata: { message_type: 'notification', subscription_type: 'channel.channel_points_custom_reward_redemption.add' },
      payload: { event: { id: 'redemption-1' } }
    });
    MockSocket.instances[0].sendFrame({
      metadata: { message_type: 'revocation' },
      payload: { subscription: { type: 'channel.chat.message', status: 'authorization_revoked' } }
    });
    await tick();
    expect(onChatMessage).toHaveBeenCalledOnce();
    expect(onRedemption).toHaveBeenCalledOnce();
    expect(onRevocation).toHaveBeenCalledOnce();
    client.stop();
  });

  it('attempts both subscriptions even when one registration is rejected', async () => {
    MockSocket.instances = [];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('chat scope rejected'))
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) });
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100' },
      fetchImpl,
      WebSocketImpl: MockSocket,
      logger
    });
    const started = client.start();
    MockSocket.instances[0].sendFrame(welcome('s-partial'));
    await expect(started).rejects.toThrow(/channel.chat.message/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('EventSub subscription registration failed', expect.objectContaining({
      type: 'channel.chat.message'
    }));
    client.stop();
  });

  it('re-registers only the revoked subscription on the active session', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100' },
      fetchImpl,
      WebSocketImpl: MockSocket
    });
    const started = client.start();
    const socket = MockSocket.instances[0];
    socket.sendFrame(welcome('s-revoked'));
    await started;
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    socket.sendFrame({
      metadata: { message_type: 'revocation' },
      payload: { subscription: { type: 'channel.chat.message', status: 'authorization_revoked' } }
    });
    await tick();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, options] = fetchImpl.mock.calls[2];
    expect(url).toContain('/eventsub/subscriptions');
    expect(JSON.parse(options.body)).toMatchObject({
      type: 'channel.chat.message',
      transport: { method: 'websocket', session_id: 's-revoked' }
    });
    client.stop();
  });

  it('does not concurrently retry the same revoked subscription more than once', async () => {
    MockSocket.instances = [];
    let releaseRetry;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) })
      .mockImplementationOnce(() => new Promise((resolve) => { releaseRetry = resolve; }));
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100' },
      fetchImpl,
      WebSocketImpl: MockSocket
    });
    const started = client.start();
    const socket = MockSocket.instances[0];
    socket.sendFrame(welcome('s-duplicate-revoke'));
    await started;

    const revoke = {
      metadata: { message_type: 'revocation' },
      payload: { subscription: { type: 'channel.chat.message', status: 'authorization_revoked' } }
    };
    socket.sendFrame(revoke);
    socket.sendFrame(revoke);
    await tick();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    releaseRetry({ ok: true, status: 202, json: async () => ({}) });
    await tick();
    client.stop();
  });

  it('uses Twitch reconnect URL unchanged and performs handover after welcome', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100' },
      fetchImpl,
      WebSocketImpl: MockSocket
    });
    const started = client.start();
    const oldSocket = MockSocket.instances[0];
    oldSocket.sendFrame(welcome('s-old'));
    await started;

    const reconnectUrl = 'wss://eventsub.wss.twitch.tv/ws?session=keep-this-exactly';
    oldSocket.sendFrame({
      metadata: { message_type: 'session_reconnect' },
      payload: { session: { reconnect_url: reconnectUrl } }
    });
    const newSocket = MockSocket.instances[1];
    expect(newSocket.url).toBe(reconnectUrl);
    expect(oldSocket.readyState).toBe(MockSocket.OPEN);
    newSocket.sendFrame(welcome('s-new'));
    await tick();
    expect(oldSocket.readyState).toBe(MockSocket.CLOSED);
    expect(client.getSessionId()).toBe('s-new');
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no duplicate subscriptions on handover
    client.stop();
  });

  it('falls back to a fresh session when a pending handover socket fails after the old socket closes', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    const timers = [];
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100' },
      fetchImpl,
      WebSocketImpl: MockSocket,
      setTimer: (fn) => { timers.push(fn); return fn; },
      clearTimer: vi.fn(),
      reconnectDelayMs: 0
    });
    const started = client.start();
    const oldSocket = MockSocket.instances[0];
    oldSocket.sendFrame(welcome('s-old'));
    await started;

    oldSocket.sendFrame({
      metadata: { message_type: 'session_reconnect' },
      payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?handover=1' } }
    });
    const handoverSocket = MockSocket.instances[1];
    oldSocket.close(1006, 'old connection ended before handover welcome');
    expect(MockSocket.instances).toHaveLength(2); // no competing fresh session
    handoverSocket.close(1006, 'handover failed');
    await tick();

    expect(timers.length).toBeGreaterThanOrEqual(2); // keepalive + fallback timer
    const fallback = timers.at(-1);
    fallback();
    await tick();
    const freshSocket = MockSocket.instances[2];
    expect(freshSocket).toBeDefined();
    freshSocket.sendFrame(welcome('s-fresh'));
    await tick();

    expect(client.getSessionId()).toBe('s-fresh');
    expect(fetchImpl).toHaveBeenCalledTimes(4); // both subscriptions recreated on fresh session
    client.stop();
  });

  it('recreates subscriptions after an unexpected close', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    const timers = [];
    const client = createEventSubClient({
      config: { clientId: 'client', accessToken: 'token', broadcasterUserId: '100' },
      fetchImpl,
      WebSocketImpl: MockSocket,
      setTimer: (fn) => { timers.push(fn); return fn; },
      clearTimer: vi.fn(),
      reconnectDelayMs: 0
    });
    const started = client.start();
    MockSocket.instances[0].sendFrame(welcome('s-old'));
    await started;
    MockSocket.instances[0].close(1006, 'network lost');
    const reconnectTimer = timers.find((fn, index) => index > 0);
    expect(reconnectTimer).toBeTypeOf('function');
    reconnectTimer();
    await tick();
    const fresh = MockSocket.instances[1];
    fresh.sendFrame(welcome('s-fresh'));
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(client.getSessionId()).toBe('s-fresh');
    client.stop();
  });
});
