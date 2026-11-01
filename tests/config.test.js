import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const validEnv = {
  TWITCH_CLIENT_ID: 'client',
  TWITCH_BROADCASTER_USER_ID: '123456',
  TWITCH_BROADCASTER_LOGIN: 'Example_User',
  TWITCH_USER_ACCESS_TOKEN: 'token'
};

describe('loadConfig', () => {
  it('rejects missing required environment variables', () => {
    expect(() => loadConfig({})).toThrow(/Missing required environment variables/);
  });

  it('loads numeric broadcaster ID and defaults bot identity to broadcaster', () => {
    const config = loadConfig(validEnv);
    expect(config.twitch).toMatchObject({
      clientId: 'client',
      broadcasterUserId: '123456',
      broadcasterLogin: 'example_user',
      botUserId: '123456'
    });
  });

  it('rejects malformed broadcaster and bot IDs', () => {
    expect(() => loadConfig({ ...validEnv, TWITCH_BROADCASTER_USER_ID: 'not-numeric' }))
      .toThrow(/must be a numeric Twitch user ID/);
    expect(() => loadConfig({ ...validEnv, TWITCH_BOT_USER_ID: 'not-numeric' }))
      .toThrow(/TWITCH_BOT_USER_ID must be a numeric Twitch user ID/);
  });

  it('loads the optional Gravity Curse reward ID', () => {
    expect(loadConfig({ ...validEnv, TWITCH_GRAVITY_REWARD_ID: 'reward-123' }).twitch.gravityRewardId)
      .toBe('reward-123');
  });
});
