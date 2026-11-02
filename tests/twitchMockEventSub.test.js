import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createCurseEngine } from '../src/engine/curseEngine.js';
import { createOverlayServer } from '../src/websocket/overlayServer.js';
import { OVERLAY_EVENTS } from '../src/websocket/overlayEvents.js';
import { createEventSubClient } from '../src/twitch/eventsub.js';
import { startTwitchIntegration } from '../src/twitch/index.js';
import { createChannelPointsHandler } from '../src/twitch/channelPointsHandler.js';
import { createApplication } from '../src/server.js';

const BROADCASTER_ID = '123456789';
const REWARD_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_TYPE = 'channel.channel_points_custom_reward_redemption.add';

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

class MockIo extends EventEmitter {
  constructor() { super(); this.emitted = []; }
  emit(event, ...args) {
    if (event !== 'connection' && event !== 'disconnect') this.emitted.push({ event, payload: args[0] });
    return super.emit(event, ...args);
  }
  close() {}
}

class MockHttpServer extends EventEmitter {
  listen(_port, _host, callback) { callback(); }
  address() { return { port: 3000 }; }
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const welcome = (id = 'mock-session') => ({
  metadata: { message_type: 'session_welcome' },
  payload: { session: { id, status: 'connected', keepalive_timeout_seconds: 30, reconnect_url: null } }
});
const redemption = ({
  id = 'mock-redemption-1',
  broadcasterUserId = BROADCASTER_ID,
  rewardId = REWARD_ID
} = {}) => ({
  metadata: {
    message_type: 'notification',
    message_id: `message-${id}`,
    subscription_type: EVENT_TYPE
  },
  payload: {
    subscription: { type: EVENT_TYPE, version: '1', status: 'enabled' },
    event: {
      id,
      broadcaster_user_id: broadcasterUserId,
      broadcaster_user_login: 'local_broadcaster',
      user_id: 'viewer-100',
      user_login: 'viewer',
      user_name: 'Viewer',
      reward: { id: rewardId, title: 'Gravity Curse', cost: 100 },
      redeemed_at: '2026-11-02T12:00:00Z'
    }
  }
});
const mockEnv = (overrides = {}) => ({
  NODE_ENV: 'test',
  TWITCH_ENABLED: 'true',
  TWITCH_EVENTSUB_MODE: 'mock',
  TWITCH_BROADCASTER_USER_ID: BROADCASTER_ID,
  TWITCH_GRAVITY_REWARD_ID: REWARD_ID,
  ...overrides
});

afterEach(() => {
  vi.useRealTimers();
  MockSocket.instances = [];
});

describe('local Twitch CLI mock EventSub mode', () => {
  it('defaults to the local mock WebSocket URL and needs no Twitch credentials', () => {
    expect(loadConfig(mockEnv()).twitch).toMatchObject({
      eventSubMode: 'mock',
      eventSubUrl: 'ws://127.0.0.1:8080/ws',
      broadcasterUserId: BROADCASTER_ID,
      gravityRewardId: REWARD_ID,
      clientId: '',
      accessToken: ''
    });
  });

  it('discards unused production credentials and bot settings in mock configuration', () => {
    expect(loadConfig(mockEnv({
      TWITCH_CLIENT_ID: 'should-not-be-retained',
      TWITCH_CLIENT_SECRET: 'should-not-be-retained',
      TWITCH_USER_ACCESS_TOKEN: 'should-not-be-retained',
      TWITCH_BOT_USER_ID: 'not-needed-in-mock'
    })).twitch).toMatchObject({
      clientId: '',
      clientSecret: '',
      accessToken: '',
      botUserId: BROADCASTER_ID
    });
  });

  it('uses a configured local WebSocket URL and rejects non-loopback URLs', () => {
    expect(loadConfig(mockEnv({
      TWITCH_EVENTSUB_WS_URL: 'ws://localhost:9090/ws'
    })).twitch.eventSubUrl).toBe('ws://localhost:9090/ws');
    expect(() => loadConfig(mockEnv({
      TWITCH_EVENTSUB_WS_URL: 'wss://eventsub.wss.twitch.tv/ws'
    }))).toThrow(/must use ws:\/\//);
    expect(() => loadConfig(mockEnv({
      TWITCH_EVENTSUB_WS_URL: 'ws://192.0.2.10:8080/ws'
    }))).toThrow(/must use ws:\/\//);
  });

  it('requires broadcaster ID and reward ID in mock mode, but not Twitch credentials or login', () => {
    expect(() => loadConfig({ TWITCH_EVENTSUB_MODE: 'mock' }))
      .toThrow(/TWITCH_BROADCASTER_USER_ID, TWITCH_GRAVITY_REWARD_ID/);
    expect(loadConfig(mockEnv({ TWITCH_BROADCASTER_LOGIN: '' })).twitch.broadcasterLogin).toBe('');
  });

  it('rejects mock mode in production before creating the HTTP overlay server', async () => {
    const overlayFactory = vi.fn();
    await expect(createApplication({
      env: mockEnv({ NODE_ENV: 'production', TWITCH_ENABLED: 'false' }),
      engine: createCurseEngine(),
      overlayFactory
    })).rejects.toThrow(/only permitted when NODE_ENV is not production/);
    expect(overlayFactory).not.toHaveBeenCalled();
  });

  it('connects only to the configured mock URL and skips production registration APIs', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn();
    const client = createEventSubClient({
      config: loadConfig(mockEnv({ TWITCH_EVENTSUB_WS_URL: 'ws://localhost:9090/ws' })).twitch,
      fetchImpl,
      WebSocketImpl: MockSocket
    });
    const started = client.start();
    const socket = MockSocket.instances[0];
    expect(socket.url).toBe('ws://localhost:9090/ws');
    socket.sendFrame(welcome());
    await expect(started).resolves.toEqual({ sessionId: 'mock-session' });
    expect(fetchImpl).not.toHaveBeenCalled();
    client.stop();
  });

  it('reconnects only to the configured local URL after a mock socket closes', async () => {
    vi.useFakeTimers();
    MockSocket.instances = [];
    const client = createEventSubClient({
      config: loadConfig(mockEnv({ TWITCH_EVENTSUB_WS_URL: 'ws://localhost:9090/ws' })).twitch,
      WebSocketImpl: MockSocket,
      reconnectDelayMs: 250
    });
    const started = client.start();
    const firstSocket = MockSocket.instances[0];
    firstSocket.sendFrame(welcome());
    await started;
    firstSocket.close(1006, 'local mock server restarted');
    vi.advanceTimersByTime(250);
    expect(MockSocket.instances).toHaveLength(2);
    expect(MockSocket.instances[1].url).toBe('ws://localhost:9090/ws');
    client.stop();
  });

  it('routes a valid mock redemption through the shared engine and broadcasts existing overlay events', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z').getTime() });
    MockSocket.instances = [];
    const engine = createCurseEngine();
    const io = new MockIo();
    const overlay = createOverlayServer({
      engine,
      httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => io),
      logger: logger()
    });
    const log = logger();
    const fetchImpl = vi.fn();
    const integrationPromise = startTwitchIntegration({
      env: mockEnv(),
      fetchImpl,
      WebSocketImpl: MockSocket,
      engine,
      logger: log
    });
    const socket = MockSocket.instances[0];
    socket.sendFrame(welcome());
    const integration = await integrationPromise;

    socket.sendFrame(redemption());
    await tick();

    expect(engine.getState()).toBe('ACTIVE');
    expect(engine.getActiveEffect()).toMatchObject({
      id: 'gravity',
      name: 'Gravity Curse',
      duration: 30_000,
      expiresAt: Date.now() + 30_000
    });
    expect(io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_ACTIVATED,
      payload: expect.objectContaining({ id: 'gravity', name: 'Gravity Curse', duration: 30_000 })
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('Gravity Curse Channel Points redemption received', expect.objectContaining({
      redemptionId: 'mock-redemption-1',
      rewardId: REWARD_ID
    }));

    vi.advanceTimersByTime(29_999);
    expect(engine.getState()).toBe('ACTIVE');
    vi.advanceTimersByTime(1);
    expect(engine.getState()).toBe('IDLE');
    expect(io.emitted).toContainEqual({
      event: OVERLAY_EVENTS.CURSE_EXPIRED,
      payload: expect.objectContaining({ id: 'gravity', expiredAt: Date.now(), state: 'idle' })
    });
    integration.dispose();
    overlay.close();
  });

  it('ignores other rewards and redemptions for a different broadcaster', async () => {
    MockSocket.instances = [];
    const engine = createCurseEngine();
    const integrationPromise = startTwitchIntegration({
      env: mockEnv(), fetchImpl: vi.fn(), WebSocketImpl: MockSocket, engine, logger: logger()
    });
    const socket = MockSocket.instances[0];
    socket.sendFrame(welcome());
    const integration = await integrationPromise;

    socket.sendFrame(redemption({ rewardId: 'another-reward-id' }));
    socket.sendFrame(redemption({ id: 'wrong-channel', broadcasterUserId: '999999999' }));
    await tick();

    expect(engine.getState()).toBe('IDLE');
    integration.dispose();
  });

  it('rejects malformed notifications and duplicate IDs without double activation', async () => {
    const activateCurse = vi.fn().mockReturnValue({ activated: true });
    const handler = createChannelPointsHandler({
      broadcasterUserId: BROADCASTER_ID,
      gravityRewardId: REWARD_ID,
      activateCurse
    });
    await expect(handler({ metadata: { message_type: 'notification' }, payload: {} }))
      .resolves.toMatchObject({ handled: false, reason: 'malformed-notification' });
    await expect(handler(redemption({ broadcasterUserId: '999999999' })))
      .resolves.toMatchObject({ handled: false, reason: 'broadcaster-mismatch' });
    await expect(handler(redemption({}))).resolves.toMatchObject({ activated: true });
    await expect(handler(redemption({}))).resolves.toMatchObject({
      activated: false, duplicate: true, reason: 'duplicate-redemption'
    });
    expect(activateCurse).toHaveBeenCalledOnce();
  });

  it('does not expose credential-like values in overlay events or mock logs', async () => {
    MockSocket.instances = [];
    const log = logger();
    const engine = createCurseEngine();
    const io = new MockIo();
    const overlay = createOverlayServer({
      engine, httpServer: new MockHttpServer(),
      SocketIOServerImpl: vi.fn(() => io), logger: logger()
    });
    const fetchImpl = vi.fn();
    const integrationPromise = startTwitchIntegration({
      env: mockEnv({
        TWITCH_CLIENT_ID: 'mock-client-id',
        TWITCH_CLIENT_SECRET: 'mock-client-secret',
        TWITCH_USER_ACCESS_TOKEN: 'mock-access-token'
      }), fetchImpl, WebSocketImpl: MockSocket, engine, logger: log
    });
    MockSocket.instances[0].sendFrame(welcome());
    const integration = await integrationPromise;
    MockSocket.instances[0].sendFrame(redemption());
    await tick();

    const publicAndLogData = JSON.stringify({ emitted: io.emitted, logs: [log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls] });
    expect(publicAndLogData).not.toMatch(/accessToken|clientSecret|TWITCH_USER_ACCESS_TOKEN|TWITCH_CLIENT_SECRET|mock-client-id|mock-client-secret|mock-access-token/);
    expect(fetchImpl).not.toHaveBeenCalled();
    integration.dispose();
    overlay.close();
  });

  it('keeps production as the default and still validates auth and registers subscriptions', async () => {
    MockSocket.instances = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          client_id: 'production-client',
          user_id: BROADCASTER_ID,
          login: 'local_broadcaster',
          expires_in: 3600,
          scopes: ['user:read:chat', 'channel:read:redemptions']
        })
      })
      .mockResolvedValue({
        ok: true, status: 202, json: async () => ({ data: [{ id: 'registered-subscription' }] })
      });
    const env = {
      NODE_ENV: 'test',
      TWITCH_CLIENT_ID: 'production-client',
      TWITCH_BROADCASTER_USER_ID: BROADCASTER_ID,
      TWITCH_BROADCASTER_LOGIN: 'local_broadcaster',
      TWITCH_USER_ACCESS_TOKEN: 'production-token',
      TWITCH_GRAVITY_REWARD_ID: REWARD_ID
    };
    expect(loadConfig(env).twitch).toMatchObject({
      eventSubMode: 'production',
      eventSubUrl: 'wss://eventsub.wss.twitch.tv/ws'
    });
    const integrationPromise = startTwitchIntegration({
      env, fetchImpl, WebSocketImpl: MockSocket,
      engine: createCurseEngine(), logger: logger(),
      setIntervalImpl: vi.fn(() => 1), clearIntervalImpl: vi.fn()
    });
    await vi.waitFor(() => expect(MockSocket.instances).toHaveLength(1));
    const socket = MockSocket.instances[0];
    expect(socket.url).toBe('wss://eventsub.wss.twitch.tv/ws');
    socket.sendFrame(welcome('production-session'));
    const integration = await integrationPromise;

    expect(integration.auth).toMatchObject({ userId: BROADCASTER_ID, login: 'local_broadcaster' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://id.twitch.tv/oauth2/validate');
    expect(fetchImpl.mock.calls.slice(1).every(([url]) => String(url).includes('/eventsub/subscriptions'))).toBe(true);
    integration.dispose();
  });
});
