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

## Local Channel Points Testing with Twitch CLI Mock EventSub

This local-only test exercises the existing Channel Points redemption handler, the shared in-memory Curse Engine, and the existing Socket.IO overlay events. It does not create a real Twitch reward, redeem Channel Points on Twitch, or prove that a real redemption works. It is useful even when the broadcaster is not a Twitch Affiliate or Partner because the event is simulated by Twitch CLI.

Install the official [Twitch CLI](https://dev.twitch.tv/docs/cli/) for your operating system. This mock WebSocket workflow does not need a Twitch Client ID, Client Secret, User Access Token, OAuth scopes, or a real Channel Points reward. The mock server must remain bound to loopback; do not expose port 8080 publicly. Do not start it with `--require-subscription`: this MVP intentionally uses the documented no-subscription-required workflow and does not emulate Twitch subscription registration.

Use three terminals from the StreamAlchemy repository root.

### Terminal 1 — start the local mock EventSub WebSocket server

```bash
twitch event websocket start-server
```

The Twitch CLI mock server listens on `127.0.0.1:8080` and StreamAlchemy connects to `ws://127.0.0.1:8080/ws`. Leave this terminal running.

### Terminal 2 — start StreamAlchemy in mock mode

Create the local configuration file:

```bash
cp .env.mock.example .env
```

Edit `.env` and set `TWITCH_BROADCASTER_USER_ID` to the numeric broadcaster ID you will pass as `--to-user` in Terminal 3. Keep `TWITCH_GRAVITY_REWARD_ID` equal to the example UUID shown below, unless you also change the trigger's `--item-id` to the same value.

```dotenv
TWITCH_ENABLED=true
TWITCH_EVENTSUB_MODE=mock
TWITCH_EVENTSUB_WS_URL=ws://127.0.0.1:8080/ws
TWITCH_BROADCASTER_USER_ID=YOUR_NUMERIC_BROADCASTER_USER_ID
TWITCH_GRAVITY_REWARD_ID=11111111-1111-4111-8111-111111111111
NODE_ENV=development
```

Start the application:

```bash
npm start
```

The startup logs should identify local mock mode and show an EventSub socket connection/welcome. Mock mode intentionally skips production Twitch token validation, hourly token revalidation, and Twitch API subscription registration. The mode is refused when `NODE_ENV=production`. Its WebSocket URL is restricted to loopback addresses, and it never falls back to the production EventSub endpoint.

### Terminal 3 — trigger a simulated Channel Points redemption

Replace `YOUR_BROADCASTER_USER_ID` with exactly the same numeric ID configured in Terminal 2:

```bash
twitch event trigger channel.channel_points_custom_reward_redemption.add --transport=websocket --item-id=11111111-1111-4111-8111-111111111111 --item-name="Gravity Curse" --to-user=YOUR_BROADCASTER_USER_ID
```

The `--to-user` value must match `TWITCH_BROADCASTER_USER_ID`. The `--item-id` value must match `TWITCH_GRAVITY_REWARD_ID` exactly. The item name is descriptive; StreamAlchemy validates the reward ID, not its title.

### Verify the flow

1. Confirm StreamAlchemy reports that it connected to the local mock EventSub server and received a session welcome.
2. Confirm the application logs a Channel Points redemption notification with the expected reward ID.
3. Confirm the configured reward ID and broadcaster identity are accepted. A different reward ID or broadcaster ID must be ignored.
4. Confirm the notification passes through the existing Channel Points handler into the single central Curse Engine.
5. Open `http://localhost:3000/overlay/` (or the configured local overlay URL) and confirm Gravity Curse and its countdown appear.
6. Confirm the existing Socket.IO `curse:activated` event is emitted with the normal public payload.
7. Confirm the curse remains active until its original 30-second timer expires. At 30 seconds, confirm the existing `curse:expired` event is emitted and the overlay returns to its inactive state.
8. Trigger the same event again if you want to verify duplicate-redemption deduplication; it must not activate the curse twice.

The overlay event contract and 30-second engine timer are the same as the production integration. Mock notifications do not fulfil a Twitch redemption because no real redemption exists and mock mode does not call the Twitch redemption API.

### Stop the mock test and restore production mode

Stop StreamAlchemy with Ctrl+C in Terminal 2, then stop the Twitch CLI mock server with Ctrl+C in Terminal 1. To return to production configuration, replace the local mock `.env` with the production template and enter the real production values locally:

```bash
cp .env.example .env
```

Set `TWITCH_EVENTSUB_MODE=production` (or omit it, since production is the default), provide the required production Twitch configuration and a real Gravity Curse reward ID, and remove the mock URL setting. Do not deploy with mock mode enabled. Production mode retains Twitch token validation, the existing authorization scopes, subscription registration, and the production EventSub URL.

**Important:** this is a simulated EventSub notification test only. It does not test a real Channel Points redemption, does not create a reward on Twitch, and does not establish eligibility for Channel Points. A real redemption still requires a channel eligible for Channel Points (Affiliate or Partner) and a separately completed live Twitch/OBS acceptance test.

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
