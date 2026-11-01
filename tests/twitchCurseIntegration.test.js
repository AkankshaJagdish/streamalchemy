import { describe, expect, it, vi } from 'vitest';
import { createChannelPointsHandler } from '../src/twitch/channelPointsHandler.js';

describe('Twitch sources share the Curse Engine activation API', () => {
  it('sends a designated Channel Points redemption through the injected engine activation callback', async () => {
    const activateCurse = vi.fn().mockReturnValue({ activated: true });
    const handler = createChannelPointsHandler({
      gravityRewardId: 'gravity-reward-123',
      activateCurse
    });

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
          reward: { id: 'gravity-reward-123', title: 'Gravity Curse' }
        }
      }
    };

    await expect(handler(notification)).resolves.toMatchObject({
      handled: true, activated: true
    });
    expect(activateCurse).toHaveBeenCalledWith({
      curse: 'gravity',
      source: 'channel-points',
      eventId: 'redemption-1',
      viewer: { id: 'viewer-1', username: 'viewer' }
    });
  });
});
