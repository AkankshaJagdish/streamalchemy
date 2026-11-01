import { describe, expect, it, vi } from 'vitest';
import { validateAccessToken, TwitchAuthError } from '../src/twitch/auth.js';

const validToken = {
  client_id: 'client-123',
  user_id: '100',
  login: 'broadcaster',
  expires_in: 3600,
  scopes: ['user:read:chat', 'channel:read:redemptions']
};

function fetchResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('validateAccessToken', () => {
  it('validates token identity, expiry and scopes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fetchResponse(validToken));
    await expect(validateAccessToken({
      accessToken: 'secret-token',
      clientId: 'client-123',
      expectedUserId: '100',
      expectedLogin: 'broadcaster',
      fetchImpl
    })).resolves.toMatchObject({ userId: '100', expiresIn: 3600 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://id.twitch.tv/oauth2/validate',
      expect.objectContaining({ headers: { Authorization: 'OAuth secret-token' } })
    );
  });

  it('rejects invalid tokens', async () => {
    await expect(validateAccessToken({
      accessToken: 'bad',
      clientId: 'client-123',
      fetchImpl: vi.fn().mockResolvedValue(fetchResponse({}, 401))
    })).rejects.toThrow(/invalid or expired/i);
  });

  it('rejects a mismatched client ID', async () => {
    await expect(validateAccessToken({
      accessToken: 't',
      clientId: 'other',
      requiredScopes: [],
      fetchImpl: vi.fn().mockResolvedValue(fetchResponse(validToken))
    })).rejects.toThrow(/different Client ID/i);
  });

  it('rejects insufficient scopes', async () => {
    await expect(validateAccessToken({
      accessToken: 't',
      clientId: 'client-123',
      requiredScopes: ['user:read:chat', 'channel:read:redemptions', 'channel:manage:redemptions'],
      fetchImpl: vi.fn().mockResolvedValue(fetchResponse(validToken))
    })).rejects.toThrow(/missing required scopes/i);
  });

  it('rejects app access tokens for WebSocket EventSub', async () => {
    await expect(validateAccessToken({
      accessToken: 't',
      clientId: 'client-123',
      requiredScopes: [],
      fetchImpl: vi.fn().mockResolvedValue(fetchResponse({ client_id: 'client-123', scopes: [], expires_in: 20 }))
    })).rejects.toThrow(/User Access Token is required/i);
  });

  it('rejects missing configuration', async () => {
    await expect(validateAccessToken({ accessToken: '', clientId: '' })).rejects.toBeInstanceOf(TwitchAuthError);
  });
});
