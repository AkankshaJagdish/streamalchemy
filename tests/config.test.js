import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('rejects missing required environment variables', () => {
    expect(() => loadConfig({})).toThrow(/Missing required environment variables/);
  });

  it('loads broadcaster and defaults bot identity to broadcaster', () => {
    const config = loadConfig({
      TWITCH_CLIENT_ID: 'client',
      TWITCH_BROADCASTER_USER_ID: '123',
      TWITCH_BROADCASTER_LOGIN: 'Example_User',
      TWITCH_USER_ACCESS_TOKEN: 'token'
    });
    expect(config.twitch).toMatchObject({
      clientId: 'client',
      broadcasterUserId: '123',
      broadcasterLogin: 'example_user',
      botUserId: '123'
    });
  });
});
