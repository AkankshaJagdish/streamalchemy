import { REQUIRED_TWITCH_SCOPES } from '../config.js';

export class TwitchAuthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TwitchAuthError';
    this.details = details;
  }
}

export async function validateAccessToken({
  accessToken,
  clientId,
  expectedUserId,
  expectedLogin,
  requiredScopes = REQUIRED_TWITCH_SCOPES,
  fetchImpl = fetch
}) {
  if (!accessToken || !clientId) {
    throw new TwitchAuthError('A Twitch access token and client ID are required');
  }

  let response;
  try {
    response = await fetchImpl('https://id.twitch.tv/oauth2/validate', {
      method: 'GET',
      headers: { Authorization: `OAuth ${accessToken}` }
    });
  } catch (error) {
    throw new TwitchAuthError('Unable to reach Twitch token validation service', {
      cause: error.message
    });
  }

  if (response.status === 401) {
    throw new TwitchAuthError('Twitch access token is invalid or expired');
  }
  if (!response.ok) {
    throw new TwitchAuthError(`Twitch token validation failed (HTTP ${response.status})`);
  }

  const token = await response.json();
  if (token.client_id !== clientId) {
    throw new TwitchAuthError('Twitch token belongs to a different Client ID');
  }
  if (!token.user_id) {
    throw new TwitchAuthError('A User Access Token is required; App Access Tokens cannot use EventSub WebSockets');
  }
  if (expectedUserId && token.user_id !== expectedUserId) {
    throw new TwitchAuthError('Twitch token user ID does not match the configured broadcaster/bot identity', {
      expectedUserId,
      actualUserId: token.user_id
    });
  }
  if (expectedLogin && token.login?.toLowerCase() !== expectedLogin.toLowerCase()) {
    throw new TwitchAuthError('Twitch token login does not match TWITCH_BROADCASTER_LOGIN');
  }
  if (!Number.isInteger(token.expires_in) || token.expires_in <= 0) {
    throw new TwitchAuthError('Twitch token has expired or returned an invalid expiration');
  }

  const grantedScopes = Array.isArray(token.scopes) ? token.scopes : [];
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  if (missingScopes.length) {
    throw new TwitchAuthError(
      `Twitch token is missing required scopes: ${missingScopes.join(', ')}`,
      { missingScopes, grantedScopes }
    );
  }

  return Object.freeze({
    clientId: token.client_id,
    userId: token.user_id,
    login: token.login,
    expiresIn: token.expires_in,
    scopes: Object.freeze([...grantedScopes])
  });
}
