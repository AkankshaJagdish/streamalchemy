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
    const message = response.status === 409
      ? 'EventSub subscription already exists for this event type and condition (HTTP 409)'
      : (body?.message ?? `Twitch API request failed (HTTP ${response.status})`);
    throw new TwitchApiError(message, { status: response.status, body });
  }

  return { created: true, data: body?.data?.[0] ?? null };
}
