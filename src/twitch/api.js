const EVENTSUB_SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';

export class TwitchApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'TwitchApiError';
    this.status = status;
    this.body = body;
  }
}

export async function createEventSubSubscription({
  clientId,
  accessToken,
  subscription,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(EVENTSUB_SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(subscription)
  });

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 409) {
      return { created: false, duplicate: true, data: body?.data?.[0] ?? null };
    }
    const safeMessage = body?.message ?? `Twitch API request failed (HTTP ${response.status})`;
    throw new TwitchApiError(safeMessage, { status: response.status, body });
  }

  return { created: true, duplicate: false, data: body?.data?.[0] ?? null };
}
