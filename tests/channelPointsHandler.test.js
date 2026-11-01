import { describe, expect, it, vi } from 'vitest';
import { createChannelPointsHandler } from '../src/twitch/channelPointsHandler.js';
import { createRedemptionService } from '../src/twitch/redemptionService.js';

const REWARD_ID = 'gravity-reward-123';
const envelope = (overrides = {}) => ({
  metadata: {
    message_type: 'notification',
    subscription_type: 'channel.channel_points_custom_reward_redemption.add'
  },
  payload: {
    event: {
      id: 'redemption-1',
      user_id: 'viewer-1',
      user_login: 'viewer',
      reward: { id: REWARD_ID, title: 'Gravity Curse' },
      ...overrides
    }
  }
});

describe('Channel Points handler', () => {
  it('activates Gravity Curse for the configured reward ID', async () => {
    const activateCurse = vi.fn().mockReturnValue({ activated: true });
    const handler = createChannelPointsHandler({ gravityRewardId: REWARD_ID, activateCurse });

    await expect(handler(envelope())).resolves.toMatchObject({
      handled: true, activated: true, redemptionId: 'redemption-1', rewardId: REWARD_ID
    });
    expect(activateCurse).toHaveBeenCalledWith({
      curse: 'gravity',
      source: 'channel-points',
      eventId: 'redemption-1',
      viewer: { id: 'viewer-1', username: 'viewer' }
    });
  });

  it('ignores an incorrect reward ID', async () => {
    const activateCurse = vi.fn();
    const handler = createChannelPointsHandler({ gravityRewardId: REWARD_ID, activateCurse });
    await expect(handler(envelope({ reward: { id: 'other-id', title: 'Gravity Curse' } })))
      .resolves.toMatchObject({ activated: false, reason: 'unrelated-reward' });
    expect(activateCurse).not.toHaveBeenCalled();
  });

  it('does not activate when the configured reward ID is missing', async () => {
    const activateCurse = vi.fn();
    const handler = createChannelPointsHandler({ activateCurse });
    await expect(handler(envelope())).resolves.toMatchObject({
      activated: false, reason: 'gravity-reward-not-configured'
    });
    expect(activateCurse).not.toHaveBeenCalled();
  });

  it('does not activate the same redemption twice', async () => {
    const activateCurse = vi.fn().mockResolvedValue({ activated: true });
    const handler = createChannelPointsHandler({ gravityRewardId: REWARD_ID, activateCurse });
    await handler(envelope());
    await expect(handler(envelope())).resolves.toMatchObject({
      activated: false, duplicate: true, reason: 'duplicate-redemption'
    });
    expect(activateCurse).toHaveBeenCalledOnce();
  });

  it('rejects malformed notification envelopes and missing fields', async () => {
    const activateCurse = vi.fn();
    const handler = createChannelPointsHandler({ gravityRewardId: REWARD_ID, activateCurse });
    await expect(handler({ payload: {} })).resolves.toMatchObject({
      handled: false, reason: 'malformed-notification'
    });
    await expect(handler(envelope({ reward: { id: REWARD_ID } }))).resolves.toMatchObject({
      handled: false, reason: 'malformed-redemption'
    });
    expect(activateCurse).not.toHaveBeenCalled();
  });

  it('does not cache a redemption if engine activation fails', async () => {
    const activateCurse = vi.fn()
      .mockReturnValueOnce({ activated: false, reason: 'already-active' })
      .mockReturnValueOnce({ activated: true });
    const handler = createChannelPointsHandler({ gravityRewardId: REWARD_ID, activateCurse });
    await expect(handler(envelope())).resolves.toMatchObject({ activated: false });
    await expect(handler(envelope())).resolves.toMatchObject({ activated: true });
    expect(activateCurse).toHaveBeenCalledTimes(2);
  });

  it('does not reactivate when fulfillment is unavailable', async () => {
    const activateCurse = vi.fn().mockReturnValue({ activated: true });
    const fulfillRedemption = vi.fn().mockResolvedValue({
      fulfilled: false, reason: 'missing-channel-manage-redemptions-scope'
    });
    const handler = createChannelPointsHandler({
      gravityRewardId: REWARD_ID,
      activateCurse,
      redemptionService: { fulfillRedemption }
    });
    const first = await handler(envelope());
    const duplicate = await handler(envelope());
    expect(first.fulfillment).toMatchObject({
      fulfilled: false, reason: 'missing-channel-manage-redemptions-scope'
    });
    expect(duplicate).toMatchObject({ duplicate: true });
    expect(activateCurse).toHaveBeenCalledOnce();
    expect(fulfillRedemption).toHaveBeenCalledOnce();
  });
});

describe('Redemption fulfillment service', () => {
  const config = {
    clientId: 'client',
    accessToken: 'token',
    broadcasterUserId: '123'
  };

  it('does not make an API call without explicit manage-redemptions authorization', async () => {
    const fetchImpl = vi.fn();
    const service = createRedemptionService({ ...config, fetchImpl });
    await expect(service.fulfillRedemption({
      redemptionId: 'redemption-1', rewardId: REWARD_ID
    })).resolves.toEqual({
      fulfilled: false, reason: 'missing-channel-manage-redemptions-scope'
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('marks a redemption fulfilled when the API succeeds and permission is enabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'redemption-1', status: 'FULFILLED' }] })
    });
    const service = createRedemptionService({ ...config, fetchImpl, canManageRedemptions: true });
    await expect(service.fulfillRedemption({
      redemptionId: 'redemption-1', rewardId: REWARD_ID
    })).resolves.toMatchObject({ fulfilled: true });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('broadcaster_id=123');
    expect(String(url)).toContain('reward_id=gravity-reward-123');
    expect(String(url)).toContain('id=redemption-1');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ status: 'FULFILLED' });
  });

  it('reports fulfillment failure without reporting success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Missing scope' })
    });
    const service = createRedemptionService({ ...config, fetchImpl, canManageRedemptions: true });
    await expect(service.fulfillRedemption({
      redemptionId: 'redemption-1', rewardId: REWARD_ID
    })).rejects.toThrow('Missing scope');
  });
});
