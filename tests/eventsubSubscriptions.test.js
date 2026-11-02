import { describe, expect, it } from 'vitest';
import { buildEventSubSubscriptions } from '../src/twitch/eventsubSubscriptions.js';

describe('buildEventSubSubscriptions', () => {
  it('builds chat and redemption subscription requests for one WebSocket session', () => {
    expect(buildEventSubSubscriptions({
      broadcasterUserId: '100',
      botUserId: '200',
      sessionId: 'session-1'
    })).toEqual([
      {
        type: 'channel.chat.message',
        version: '1',
        condition: { broadcaster_user_id: '100', user_id: '200' },
        transport: { method: 'websocket', session_id: 'session-1' }
      },
      {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: '100' },
        transport: { method: 'websocket', session_id: 'session-1' }
      }
    ]);
  });

  it('registers only chat when Channel Points are disabled', () => {
    expect(buildEventSubSubscriptions({
      broadcasterUserId: '100',
      sessionId: 'session-chat-only',
      channelPointsEnabled: false
    })).toEqual([{
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: '100', user_id: '100' },
      transport: { method: 'websocket', session_id: 'session-chat-only' }
    }]);
  });

  it('defaults chat reader identity to broadcaster identity', () => {
    const [chat] = buildEventSubSubscriptions({
      broadcasterUserId: '100',
      sessionId: 'session-1'
    });
    expect(chat.condition.user_id).toBe('100');
  });

  it('rejects invalid subscription construction inputs', () => {
    expect(() => buildEventSubSubscriptions({ sessionId: 'x' })).toThrow();
  });
});
