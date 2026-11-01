import { parseCurseCommand } from '../engine/commandParser.js';

const MAX_SEEN_MESSAGE_IDS = 10_000;

/**
 * Creates an EventSub chat message processor.
 *
 * Expected input is an EventSub notification envelope with
 * payload.event.message_id, payload.event.chatter_user_id,
 * payload.event.chatter_user_name and payload.event.message.text.
 *
 * The parser itself does not know about Twitch. This adapter extracts the
 * Twitch-specific fields and forwards only a validated, structured request.
 *
 * @param {object} options
 * @param {(request: object) => unknown | Promise<unknown>} options.activateCurse
 * @param {(message: object) => void} [options.onError]
 */
export function createChatHandler({
  activateCurse,
  onError = () => {}
} = {}) {
  if (typeof activateCurse !== 'function') {
    throw new TypeError('activateCurse must be a function');
  }
  if (typeof onError !== 'function') {
    throw new TypeError('onError must be a function');
  }

  const seenMessageIds = new Set();

  return async function handleChatNotification(notification) {
    const event = notification?.payload?.event;
    if (!event || typeof event !== 'object') {
      return { handled: false, reason: 'invalid-notification' };
    }

    const messageId = event.message_id;
    if (typeof messageId !== 'string' || messageId.length === 0) {
      return { handled: false, reason: 'missing-message-id' };
    }

    if (seenMessageIds.has(messageId)) {
      return { handled: false, reason: 'duplicate' };
    }

    // Record the ID before processing to prevent concurrent duplicate
    // notifications from triggering the same activation twice.
    seenMessageIds.add(messageId);
    if (seenMessageIds.size > MAX_SEEN_MESSAGE_IDS) {
      const oldest = seenMessageIds.values().next().value;
      seenMessageIds.delete(oldest);
    }

    const messageText = event.message?.text;
    const parsed = parseCurseCommand(messageText);
    if (!parsed.ok) {
      return {
        handled: true,
        activated: false,
        reason: parsed.reason
      };
    }

    const viewerId = event.chatter_user_id;
    const username = event.chatter_user_name;

    if (
      typeof viewerId !== 'string' ||
      viewerId.length === 0 ||
      typeof username !== 'string' ||
      username.length === 0
    ) {
      return { handled: true, activated: false, reason: 'invalid-viewer' };
    }

    const activationRequest = Object.freeze({
      ...parsed.request,
      source: 'twitch-chat',
      eventId: messageId,
      viewer: Object.freeze({
        id: viewerId,
        username
      })
    });

    try {
      await activateCurse(activationRequest);
      return { handled: true, activated: true, request: activationRequest };
    } catch (error) {
      onError(error);
      return { handled: true, activated: false, reason: 'activation-failed' };
    }
  };
}
