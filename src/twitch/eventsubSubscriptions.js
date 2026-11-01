export const EVENTSUB_TYPES = Object.freeze({
  CHAT_MESSAGE: 'channel.chat.message',
  CHANNEL_POINTS_REDEMPTION: 'channel.channel_points_custom_reward_redemption.add'
});

export const EVENTSUB_VERSIONS = Object.freeze({
  [EVENTSUB_TYPES.CHAT_MESSAGE]: '1',
  [EVENTSUB_TYPES.CHANNEL_POINTS_REDEMPTION]: '1'
});

export function buildEventSubSubscriptions({
  broadcasterUserId,
  botUserId = broadcasterUserId,
  sessionId
}) {
  if (!broadcasterUserId || !/^\d+$/.test(String(broadcasterUserId))) {
    throw new TypeError('A numeric broadcasterUserId is required');
  }
  if (!botUserId || !/^\d+$/.test(String(botUserId))) {
    throw new TypeError('A numeric botUserId is required');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw new TypeError('A WebSocket sessionId is required');
  }

  return [
    {
      type: EVENTSUB_TYPES.CHAT_MESSAGE,
      version: EVENTSUB_VERSIONS[EVENTSUB_TYPES.CHAT_MESSAGE],
      condition: {
        broadcaster_user_id: String(broadcasterUserId),
        user_id: String(botUserId)
      },
      transport: { method: 'websocket', session_id: sessionId }
    },
    {
      type: EVENTSUB_TYPES.CHANNEL_POINTS_REDEMPTION,
      version: EVENTSUB_VERSIONS[EVENTSUB_TYPES.CHANNEL_POINTS_REDEMPTION],
      condition: { broadcaster_user_id: String(broadcasterUserId) },
      transport: { method: 'websocket', session_id: sessionId }
    }
  ];
}
