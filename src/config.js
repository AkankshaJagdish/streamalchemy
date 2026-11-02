const PRODUCTION_REQUIRED_ENV = [
  'TWITCH_CLIENT_ID',
  'TWITCH_BROADCASTER_USER_ID',
  'TWITCH_BROADCASTER_LOGIN',
  'TWITCH_USER_ACCESS_TOKEN'
];

export const DEFAULT_EVENTSUB_MODE = 'production';
export const DEFAULT_MOCK_EVENTSUB_URL = 'ws://127.0.0.1:8080/ws';

export function assertSafeEventSubMode(env = process.env) {
  const mode = String(env.TWITCH_EVENTSUB_MODE ?? DEFAULT_EVENTSUB_MODE).trim().toLowerCase();
  if (!['production', 'mock'].includes(mode)) {
    throw new Error('TWITCH_EVENTSUB_MODE must be either production or mock');
  }
  if (mode === 'mock' && String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new Error('TWITCH_EVENTSUB_MODE=mock is only permitted when NODE_ENV is not production');
  }
  return mode;
}

function validateMockWebSocketUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TWITCH_EVENTSUB_WS_URL must be a valid local WebSocket URL');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'ws:' || !['localhost', '127.0.0.1', '::1'].includes(hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error('TWITCH_EVENTSUB_WS_URL must use ws:// and resolve to localhost, 127.0.0.1, or ::1');
  }
  return url.toString();
}

export function loadConfig(env = process.env) {
  const eventSubMode = assertSafeEventSubMode(env);
  const requiredEnv = eventSubMode === 'mock'
    ? ['TWITCH_BROADCASTER_USER_ID', 'TWITCH_GRAVITY_REWARD_ID']
    : PRODUCTION_REQUIRED_ENV;
  const missing = requiredEnv.filter((key) => !String(env[key] ?? '').trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const broadcasterUserId = String(env.TWITCH_BROADCASTER_USER_ID).trim();
  const broadcasterLogin = String(env.TWITCH_BROADCASTER_LOGIN ?? '').trim().toLowerCase();
  const botUserId = eventSubMode === 'mock'
    ? broadcasterUserId
    : String(env.TWITCH_BOT_USER_ID ?? broadcasterUserId).trim();
  const gravityRewardId = String(env.TWITCH_GRAVITY_REWARD_ID ?? '').trim();

  if (!/^\d+$/.test(broadcasterUserId)) {
    throw new Error('TWITCH_BROADCASTER_USER_ID must be a numeric Twitch user ID');
  }
  if (eventSubMode === 'production' && !/^[a-z0-9_]{1,25}$/.test(broadcasterLogin)) {
    throw new Error('TWITCH_BROADCASTER_LOGIN must be a valid Twitch login');
  }
  if (!/^\d+$/.test(botUserId)) {
    throw new Error('TWITCH_BOT_USER_ID must be a numeric Twitch user ID');
  }
  if (gravityRewardId && !/^[A-Za-z0-9_-]+$/.test(gravityRewardId)) {
    throw new Error('TWITCH_GRAVITY_REWARD_ID must be a valid Twitch reward ID');
  }

  const eventSubUrl = eventSubMode === 'mock'
    ? validateMockWebSocketUrl(String(env.TWITCH_EVENTSUB_WS_URL ?? '').trim() || DEFAULT_MOCK_EVENTSUB_URL)
    : 'wss://eventsub.wss.twitch.tv/ws';

  return Object.freeze({
    twitch: Object.freeze({
      eventSubMode,
      clientId: eventSubMode === 'mock' ? '' : String(env.TWITCH_CLIENT_ID ?? '').trim(),
      clientSecret: eventSubMode === 'mock' ? '' : String(env.TWITCH_CLIENT_SECRET ?? '').trim(),
      broadcasterUserId,
      broadcasterLogin,
      botUserId,
      accessToken: eventSubMode === 'mock' ? '' : String(env.TWITCH_USER_ACCESS_TOKEN ?? '').trim(),
      gravityRewardId,
      eventSubUrl,
      apiBaseUrl: 'https://api.twitch.tv/helix',
      tokenValidationUrl: 'https://id.twitch.tv/oauth2/validate'
    })
  });
}

export const REQUIRED_TWITCH_SCOPES = Object.freeze([
  'user:read:chat',
  'channel:read:redemptions'
]);
