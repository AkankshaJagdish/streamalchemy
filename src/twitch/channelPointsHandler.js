const REDEMPTION_EVENT_TYPE = 'channel.channel_points_custom_reward_redemption.add';
function isValidEnvelope(notification) {
  return notification?.metadata?.message_type === 'notification'
    && (notification.metadata.subscription_type ?? notification.payload?.subscription?.type) === REDEMPTION_EVENT_TYPE;
}
export function createChannelPointsHandler({
  gravityRewardId, activateCurse, redemptionService, onReceived = () => {},
  onProcessed = async () => {}, onError = () => {}, maxProcessedIds = 10_000
}) {
  if (typeof activateCurse !== 'function') throw new TypeError('activateCurse must be a function');
  if (!Number.isInteger(maxProcessedIds) || maxProcessedIds < 1) throw new TypeError('maxProcessedIds must be a positive integer');
  const processedIds = new Set();
  const inFlightIds = new Set();
  function remember(id) {
    processedIds.add(id);
    if (processedIds.size > maxProcessedIds) processedIds.delete(processedIds.values().next().value);
  }
  return async function handleRedemption(notification) {
    if (!isValidEnvelope(notification)) return { handled: false, reason: 'malformed-notification' };
    const event = notification.payload?.event;
    const redemptionId = event?.id;
    const rewardId = event?.reward?.id;
    if (!event || typeof redemptionId !== 'string' || !redemptionId.trim()
      || typeof rewardId !== 'string' || !rewardId.trim()) return { handled: false, reason: 'malformed-redemption' };
    if (!gravityRewardId) return { handled: true, activated: false, reason: 'gravity-reward-not-configured' };
    if (rewardId !== gravityRewardId) return { handled: true, activated: false, reason: 'unrelated-reward' };
    if (processedIds.has(redemptionId) || inFlightIds.has(redemptionId)) {
      return { handled: true, activated: false, duplicate: true, reason: 'duplicate-redemption' };
    }
    inFlightIds.add(redemptionId);
    onReceived({ redemptionId, rewardId, username: event.user_login ?? event.user_name ?? 'unknown' });
    try {
      const result = await activateCurse({
        curse: 'gravity', source: 'channel-points', eventId: redemptionId,
        viewer: { id: event.user_id ?? null, username: event.user_login ?? event.user_name ?? 'unknown' }
      });
      if (!result || result.activated !== true) {
        return { handled: true, activated: false, reason: result?.reason ?? 'activation-failed', result };
      }
      // Remember as soon as the engine accepts activation. Callback/API failures
      // must never allow the same EventSub redemption to fire twice.
      remember(redemptionId);
      let fulfillment = { fulfilled: false, reason: 'fulfillment-not-configured' };
      if (redemptionService?.fulfillRedemption) {
        try {
          fulfillment = await redemptionService.fulfillRedemption({ redemptionId, rewardId });
        } catch (error) {
          fulfillment = { fulfilled: false, reason: 'fulfillment-failed' };
          onError(error, { redemptionId, rewardId, phase: 'fulfillment' });
        }
      }
      const response = { handled: true, activated: true, redemptionId, rewardId, fulfillment };
      try { await onProcessed(notification, response); }
      catch (error) { onError(error, { redemptionId, rewardId, phase: 'processed-callback' }); }
      return response;
    } catch (error) {
      onError(error, { redemptionId, rewardId, phase: 'activation' });
      return { handled: true, activated: false, reason: 'activation-failed' };
    } finally {
      inFlightIds.delete(redemptionId);
    }
  };
}
