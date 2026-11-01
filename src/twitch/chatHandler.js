import { parseCurseCommand } from '../engine/commandParser.js';

const MAX_SEEN_MESSAGE_IDS = 10_000;

export function createChatHandler({ activateCurse, onCommand = () => {}, onError = () => {} } = {}) {
  if (typeof activateCurse !== 'function') throw new TypeError('activateCurse must be a function');
  if (typeof onCommand !== 'function') throw new TypeError('onCommand must be a function');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');
  const seenMessageIds = new Set();

  return async function handleChatNotification(notification) {
    if (notification?.metadata?.message_type !== 'notification') return { handled: false, reason: 'not-a-notification' };
    const subscriptionType = notification.metadata.subscription_type ?? notification.payload?.subscription?.type;
    if (subscriptionType !== 'channel.chat.message') return { handled: false, reason: 'not-a-chat-message' };
    const event = notification?.payload?.event;
    if (!event || typeof event !== 'object') return { handled: false, reason: 'invalid-notification' };
    const messageId = event.message_id;
    if (typeof messageId !== 'string' || !messageId) return { handled: false, reason: 'missing-message-id' };
    if (seenMessageIds.has(messageId)) return { handled: false, reason: 'duplicate' };
    seenMessageIds.add(messageId);
    if (seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) seenMessageIds.delete(seenMessageIds.values().next().value);

    const parsed = parseCurseCommand(event.message?.text);
    if (!parsed.ok) return { handled: true, activated: false, reason: parsed.reason };
    const viewerId = event.chatter_user_id;
    const username = event.chatter_user_name;
    if (typeof viewerId !== 'string' || !viewerId || typeof username !== 'string' || !username) {
      return { handled: true, activated: false, reason: 'invalid-viewer' };
    }
    const request = Object.freeze({
      ...parsed.request, source: 'twitch-chat', eventId: messageId,
      viewer: Object.freeze({ id: viewerId, username })
    });
    onCommand({ messageId, username, command: event.message?.text });
    try {
      const result = await activateCurse(request);
      if (!result || result.activated !== true) {
        return { handled: true, activated: false, reason: result?.reason ?? 'activation-rejected', result };
      }
      return { handled: true, activated: true, request, result };
    } catch (error) {
      onError(error);
      return { handled: true, activated: false, reason: 'activation-failed' };
    }
  };
}
