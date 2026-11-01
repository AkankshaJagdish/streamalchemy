import { describe, expect, it, vi } from 'vitest';
import { createChatHandler } from '../src/twitch/chatHandler.js';

function notification({
  id = 'message-1',
  text = '!curse gravity',
  viewerId = 'viewer-123',
  username = 'viewer_name'
} = {}) {
  return {
    metadata: { message_id: 'notification-envelope-id' },
    payload: {
      event: {
        message_id: id,
        chatter_user_id: viewerId,
        chatter_user_name: username,
        message: { text }
      }
    }
  };
}

describe('createChatHandler', () => {
  it('forwards a valid Twitch chat command as a structured request', async () => {
    const activateCurse = vi.fn();
    const handle = createChatHandler({ activateCurse });

    const result = await handle(notification());

    expect(result.activated).toBe(true);
    expect(activateCurse).toHaveBeenCalledOnce();
    expect(activateCurse).toHaveBeenCalledWith({
      curse: 'gravity',
      durationMs: 30_000,
      source: 'twitch-chat',
      eventId: 'message-1',
      viewer: { id: 'viewer-123', username: 'viewer_name' }
    });
  });

  it('does not activate unsupported or invalid commands', async () => {
    const activateCurse = vi.fn();
    const handle = createChatHandler({ activateCurse });

    await handle(notification({ text: '!curse unknown' }));
    await handle(notification({ id: 'message-2', text: '!curse' }));
    await handle(notification({ id: 'message-3', text: '<script>alert(1)</script>' }));

    expect(activateCurse).not.toHaveBeenCalled();
  });

  it('ignores normal chat messages', async () => {
    const activateCurse = vi.fn();
    const handle = createChatHandler({ activateCurse });

    const result = await handle(notification({ text: 'hello everyone' }));

    expect(result).toMatchObject({
      handled: true,
      activated: false,
      reason: 'not-a-command'
    });
    expect(activateCurse).not.toHaveBeenCalled();
  });

  it('prevents duplicate EventSub event IDs from activating twice', async () => {
    const activateCurse = vi.fn();
    const handle = createChatHandler({ activateCurse });

    const first = await handle(notification());
    const second = await handle(notification());

    expect(first.activated).toBe(true);
    expect(second).toEqual({ handled: false, reason: 'duplicate' });
    expect(activateCurse).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent deliveries by message ID', async () => {
    let finishActivation;
    const activateCurse = vi.fn(() => new Promise((resolve) => {
      finishActivation = resolve;
    }));
    const handle = createChatHandler({ activateCurse });

    const firstPromise = handle(notification());
    const second = await handle(notification());
    finishActivation();
    const first = await firstPromise;

    expect(first.activated).toBe(true);
    expect(second).toEqual({ handled: false, reason: 'duplicate' });
    expect(activateCurse).toHaveBeenCalledOnce();
  });

  it('rejects an invalid viewer identity', async () => {
    const activateCurse = vi.fn();
    const handle = createChatHandler({ activateCurse });

    const result = await handle(notification({ viewerId: '' }));

    expect(result).toEqual({
      handled: true,
      activated: false,
      reason: 'invalid-viewer'
    });
    expect(activateCurse).not.toHaveBeenCalled();
  });

  it('reports activation failures without crashing the event consumer', async () => {
    const error = new Error('engine unavailable');
    const onError = vi.fn();
    const handle = createChatHandler({
      activateCurse: vi.fn().mockRejectedValue(error),
      onError
    });

    const result = await handle(notification());

    expect(result).toEqual({
      handled: true,
      activated: false,
      reason: 'activation-failed'
    });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('rejects invalid notification envelopes', async () => {
    const handle = createChatHandler({ activateCurse: vi.fn() });

    expect(await handle({})).toEqual({
      handled: false,
      reason: 'invalid-notification'
    });
    expect(await handle({ payload: { event: {} } })).toEqual({
      handled: false,
      reason: 'missing-message-id'
    });
  });

  it('requires an activation callback', () => {
    expect(() => createChatHandler()).toThrow(TypeError);
  });
});
