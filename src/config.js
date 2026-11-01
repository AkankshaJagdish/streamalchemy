const REQUIRED_ENV = [
  'TWITCH_CLIENT_ID',
  'TWITCH_BROADCASTER_USER_ID',
  'TWITCH_BROADCASTER_LOGIN',
  'TWITCH_USER_ACCESS_TOKEN'
];

export function loadConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !String(env[key] ?? '').trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const broadcasterUserId = String(env.TWITCH_BROADCASTER_USER_ID).trim();
  const broadcasterLogin = String(env.TWITCH_BROADCASTER_LOGIN).trim().toLowerCase();
  const botUserId = String(env.TWITCH_BOT_USER_ID ?? broadcasterUserId).trim();
  const gravityRewardId = String(env.TWITCH_GRAVITY_REWARD_ID ?? '').trim();

  if (!/^\d+$/.test(broadcasterUserId)) {
    throw new Error('TWITCH_BROADCASTER_USER_ID must be a numeric Twitch user ID');
  }
  if (!/^[a-z0-9_]{1,25}$/.test(broadcasterLogin)) {
    throw new Error('TWITCH_BROADCASTER_LOGIN must be a valid Twitch login');
  }
  if (!/^\d+$/.test(botUserId)) {
    throw new Error('TWITCH_BOT_USER_ID must be a numeric Twitch user ID');
  }
  if (gravityRewardId && !/^[A-Za-z0-9_-]+$/.test(gravityRewardId)) {
    throw new Error('TWITCH_GRAVITY_REWARD_ID must be a valid Twitch reward ID');
  }

  return Object.freeze({
    twitch: Object.freeze({
      clientId: String(env.TWITCH_CLIENT_ID).trim(),
      clientSecret: String(env.TWITCH_CLIENT_SECRET ?? '').trim(),
      broadcasterUserId,
      broadcasterLogin,
      botUserId,
      accessToken: String(env.TWITCH_USER_ACCESS_TOKEN).trim(),
      gravityRewardId,
      eventSubUrl: 'wss://eventsub.wss.twitch.tv/ws',
      apiBaseUrl: 'https://api.twitch.tv/helix',
      tokenValidationUrl: 'https://id.twitch.tv/oauth2/validate'
    })
  });
}

export const REQUIRED_TWITCH_SCOPES = Object.freeze([
  'user:read:chat',
  'channel:read:redemptions'
]);
