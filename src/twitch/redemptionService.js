import { TwitchApiError } from './api.js';

const REDEMPTION_STATUS_URL = '/channel_points/custom_rewards/redemptions';

/**
 * Twitch requires channel:manage:redemptions to update redemption status.
 * The existing MVP token intentionally requests channel:read:redemptions only,
 * so fulfillment remains unavailable unless the broadcaster explicitly opts in
 * with an appropriately scoped token in a future change.
 */
export function createRedemptionService({
  clientId,
  accessToken,
  broadcasterUserId,
  apiBaseUrl = 'https://api.twitch.tv/helix',
  fetchImpl = fetch,
  canManageRedemptions = false
}) {
  if (!clientId || !accessToken || !broadcasterUserId) {
    throw new TypeError('Redemption service requires Twitch client, token, and broadcaster configuration');
  }

  async function fulfillRedemption({ redemptionId, rewardId }) {
    if (!canManageRedemptions) {
      return {
        fulfilled: false,
        reason: 'missing-channel-manage-redemptions-scope'
      };
    }
    if (!redemptionId || !rewardId) {
      return { fulfilled: false, reason: 'invalid-redemption-identifiers' };
    }

    const url = new URL(REDEMPTION_STATUS_URL, apiBaseUrl);
    url.searchParams.set('broadcaster_id', String(broadcasterUserId));
    url.searchParams.set('reward_id', String(rewardId));
    url.searchParams.set('id', String(redemptionId));

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Client-Id': clientId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'FULFILLED' })
      });
    } catch (error) {
      throw new TwitchApiError('Unable to update Twitch redemption status', {
        body: { cause: error.message }
      });
    }

    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw new TwitchApiError(
        body?.message ?? `Twitch redemption fulfillment failed (HTTP ${response.status})`,
        { status: response.status, body }
      );
    }
    return { fulfilled: true, data: body?.data?.[0] ?? null };
  }

  return Object.freeze({ fulfillRedemption });
}
