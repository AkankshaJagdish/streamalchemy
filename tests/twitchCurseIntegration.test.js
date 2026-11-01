import { describe, expect, it, vi } from 'vitest';
import { createRedemptionHandler } from '../src/twitch/index.js';

describe('Twitch sources share the Curse Engine activation API', () => {
  it('sends the designated Channel Points redemption through the injected activation callback', async () => {
    const activateCurse = vi.fn().mockReturnValue({ activated: true });
    const onRedemption = vi.fn();
    const handler = createRedemptionHandler({ activateCurse, onRedemption });
    const notification = {
      metadata: {
        message_type: 'notification',
        subscription_type: 'channel.channel_points_custom_reward_redemption.add'
      },
      payload: {
        event: {
          id: 'redemption-1',
          user_id: 'viewer-1',
          user_login: 'viewer',
          reward: { title: 'Gravity Curse' }
        }
      }
    };

    await expect(handler(notification)).resolves.toMatchObject({
      handled: true,
      activated: true
    });
    expect(activateCurse).toHaveBeenCalledWith({
      curse: 'gravity',
      source: 'channel-points',
      eventId: 'redemption-1',
      viewer: { id: 'viewer-1', username: 'viewer' }
    });
    expect(onRedemption).toHaveBeenCalledOnce();
  });

  it('does not activate a different Channel Points reward', async () => {
    const activateCurse = vi.fn();
    const handler = createRedemptionHandler({ activateCurse });
    const notification = {
      metadata: {
        message_type: 'notification',
        subscription_type: 'channel.channel_points_custom_reward_redemption.add'
      },
      payload: { event: { id: 'redemption-2', reward: { title: 'Other reward' } } }
    };

    await expect(handler(notification)).resolves.toMatchObject({
      handled: true, activated: false, reason: 'unsupported-reward'
    });
    expect(activateCurse).not.toHaveBeenCalled();
  });
});
