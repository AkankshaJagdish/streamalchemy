# StreamAlchemy — testing instructions

## Automated tests
Requirements: Node.js 22+ and npm.

```bash
npm ci
npm test
npm run test:overlay
```

The suite uses mocked Twitch HTTP/EventSub interfaces and a fake browser/Socket.IO layer. It tests deterministic application logic; it does not authenticate to Twitch or open OBS.

Coverage includes:
- Command parser: allowed command, invalid/oversized/injected messages and unsupported curse names.
- Config and authentication: required variables, numeric IDs, broadcaster identity, token client/expiry/scopes.
- Twitch API and EventSub: subscription payloads, message routing, keepalives, reconnect handover, unexpected-close recovery and resubscription.
- Chat and Channel Points: exact command/reward validation, missing fields, duplicate message/redemption IDs, failed activation and non-fulfillment behavior.
- Curse Engine: one active effect, exact 30-second duration, expiration, state transitions, timer cleanup and shutdown.
- Overlay: public payload shape, no secret leakage, activation/expiration, reconnect snapshot and original expiry timestamp.
- Mocked end-to-end flow: chat and Channel Points through EventSub handlers and the real engine/overlay adapters.

## Manual Twitch + OBS acceptance test
A real broadcaster account, a separate viewer account and an OBS installation are required. Do not mark the live integration verified until every step below is performed successfully on the selected channel.

### Preparation
1. Register a Twitch developer app with OAuth redirect URL `http://localhost:3000`.
2. Configure Twitch CLI using `twitch configure`.
3. Generate a broadcaster User Access Token:
   `twitch token --user-token --scopes "user:read:chat channel:read:redemptions"`
4. Obtain the numeric broadcaster user ID from Helix Users.
5. Create a custom Channel Points reward named Gravity Curse and retrieve its exact reward ID.
6. Copy `.env.example` to `.env`, fill required values and verify `.env` is not staged in Git.

### Run and verify
1. Run `npm ci` and `npm start`.
2. Confirm token validation succeeds and EventSub registers both chat and Channel Points subscriptions.
3. Add OBS Browser Source `http://localhost:3000/overlay/`.
4. From the separate viewer account, send `!curse gravity`.
5. Confirm the Gravity Curse appears, countdown runs, and effect expires after 30 seconds.
6. Redeem the configured Gravity Curse Channel Points reward.
7. Confirm the same effect activates and expires.
8. Redeem another reward ID and confirm it does not activate gravity.
9. Refresh/reconnect the OBS Browser Source during an active effect. Confirm it restores the existing effect using original `expiresAt`, with only the remaining seconds displayed.
10. Refresh after expiry and confirm idle state.
11. Capture timestamps, test account/channel context (without secrets), outcome and sanitized errors.

## Expected limitation
The minimum MVP token lacks `channel:manage:redemptions`. Channel Points activation works, but the redemption is not automatically fulfilled by the application. This should not be reported as a failure unless automatic fulfillment was separately enabled and configured; automatic fulfillment is outside the current scope.

## Result record
Complete this table during human testing:

| Check | Result | Evidence / notes |
|---|---|---|
| Token validated for intended broadcaster | Not yet run | |
| Chat EventSub subscription registered | Not yet run | |
| Redemption EventSub subscription registered | Not yet run | |
| Chat command activated Gravity Curse | Not yet run | |
| Chat-triggered effect expired at 30 seconds | Not yet run | |
| Configured Channel Points reward activated Gravity Curse | Not yet run | |
| Unconfigured reward ID did not activate curse | Not yet run | |
| Redemption-triggered effect expired at 30 seconds | Not yet run | |
| Overlay reconnect preserved original expiry | Not yet run | |
| OBS rendered overlay correctly | Not yet run | |
