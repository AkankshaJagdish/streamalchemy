import { describe, expect, it, vi } from 'vitest';
import { createEventSubSubscription, TwitchApiError } from '../src/twitch/api.js';

const subscription = {
  type: 'channel.chat.message',
  version: '1',
  condition: { broadcaster_user_id: '100', user_id: '100' },
  transport: { method: 'websocket', session_id: 's1' }
};

describe('createEventSubSubscription', () => {
  it('posts the request with the required Twitch headers and body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 202, json: async () => ({ data: [{ id: 'sub-1' }] })
    });
    await expect(createEventSubSubscription({
      clientId: 'client', accessToken: 'token', subscription, fetchImpl
    })).resolves.toMatchObject({ created: true, data: { id: 'sub-1' } });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.twitch.tv/helix/eventsub/subscriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Client-Id': 'client'
        }),
        body: JSON.stringify(subscription)
      })
    );
  });

  it('surfaces a documented 409 conflict instead of assuming an unverified duplicate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 409, json: async () => ({ status: 409, message: 'already exists', id: 'sub-existing' })
    });
    await expect(createEventSubSubscription({
      clientId: 'client', accessToken: 'token', subscription, fetchImpl
    })).rejects.toMatchObject({ status: 409 });
  });

  it('surfaces other Twitch API errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({ message: 'missing scope' })
    });
    await expect(createEventSubSubscription({
      clientId: 'client', accessToken: 'token', subscription, fetchImpl
    })).rejects.toBeInstanceOf(TwitchApiError);
  });
});
