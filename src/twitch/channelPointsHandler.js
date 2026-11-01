const REDEMPTION_EVENT_TYPE = 'channel.channel_points_custom_reward_redemption.add';

function isValidEnvelope(notification) {
  return notification?.metadata?.message_type === 'notification'
    && (notification.metadata.subscription_type
      ?? notification.payload?.subscription?.type) === REDEMPTION_EVENT_TYPE;
}

/**
 * Processes only the configured custom reward.
 *
 * EventSub is at-least-once delivery. The in-memory redemption ID cache avoids
 * repeated activation for duplicate EventSub message deliveries and duplicate
 * redemption payloads during this process lifetime.
 */
export function createChannelPointsHandler({
  gravityRewardId,
  activateCurse,
  redemptionService,
  onProcessed = async () => {},
  onError = () => {},
  maxProcessedIds = 10_000
}) {
  if (typeof activateCurse !== 'function') {
    throw new TypeError('activateCurse must be a function');
  }
  if (!Number.isInteger(maxProcessedIds) || maxProcessedIds < 1) {
    throw new TypeError('maxProcessedIds must be a positive integer');
  }

  const processedRedemptionIds = new Map();
  const inFlightRedemptionIds = new Set();

  function remember(id) {
    processedRedemptionIds.set(id, Date.now());
    if (processedRedemptionIds.size > maxProcessedIds) {
      const oldestId = processedRedemptionIds.keys().next().value;
      processedRedemptionIds.delete(oldestId);
    }
  }

  return async function handleChannelPointsNotification(notification) {
    if (!isValidEnvelope(notification)) {
      return { handled: false, reason: 'malformed-notification' };
    }

    const event = notification.payload?.event;
    const redemptionId = event?.id;
    const rewardId = event?.reward?.id;

    if (!event || typeof redemptionId !== 'string' || !redemptionId.trim()
      || typeof rewardId !== 'string' || !rewardId.trim()) {
      return { handled: false, reason: 'malformed-redemption' };
    }

    if (!gravityRewardId) {
      return { handled: true, activated: false, reason: 'gravity-reward-not-configured' };
    }
    if (rewardId !== gravityRewardId) {
      return { handled: true, activated: false, reason: 'unrelated-reward' };
    }

    if (processedRedemptionIds.has(redemptionId) || inFlightRedemptionIds.has(redemptionId)) {
      return { handled: true, activated: false, duplicate: true, reason: 'duplicate-redemption' };
    }

    inFlightRedemptionIds.add(redemptionId);
    try {
      const result = await activateCurse({
        curse: 'gravity',
        source: 'channel-points',
        eventId: redemptionId,
        viewer: {
          id: event.user_id ?? null,
          username: event.user_login ?? event.user_name ?? 'unknown'
        }
      });

      if (!result || result.activated !== true) {
        // Do not remember a rejected activation. It can be retried if the
        // integration decides the redemption should be reprocessed.
        return {
          handled: true,
          activated: false,
          reason: result?.reason ?? 'activation-failed',
          result
        };
      }

      remember(redemptionId);

      let fulfillment = {
        fulfilled: false,
        reason: 'fulfillment-not-configured'
      };
      if (redemptionService?.fulfillRedemption) {
        try {
          fulfillment = await redemptionService.fulfillRedemption({ redemptionId, rewardId });
        } catch (error) {
          // Effect activation succeeded, but the redemption remains unfulfilled.
          // Do not turn a fulfillment API outage into a second effect activation.
          fulfillment = { fulfilled: false, reason: 'fulfillment-failed' };
          onError(error, { redemptionId, rewardId, phase: 'fulfillment' });
        }
      }

      const response = {
        handled: true,
        activated: true,
        redemptionId,
        rewardId,
        fulfillment
      };
      await onProcessed(notification, response);
      return response;
    } catch (error) {
      onError(error, { redemptionId, rewardId, phase: 'activation' });
      return { handled: true, activated: false, reason: 'activation-failed' };
    } finally {
      inFlightRedemptionIds.delete(redemptionId);
    }
  };
}
