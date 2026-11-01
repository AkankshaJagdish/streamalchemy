# StreamAlchemy — Twitch Gravity Curse MVP

## Real Twitch and OBS test procedure

This is a manual verification checklist for the live integration. Automated integration tests mock Twitch/EventSub; they do not certify the real channel or OBS environment.

### 1. Create a Twitch developer application
1. Open https://dev.twitch.tv/console/apps and register an application.
2. Configure the OAuth redirect URL according to the Twitch CLI authentication flow.
3. Copy the Client ID. Keep the Client Secret private; it is not sent to the overlay.

### 2. Install Twitch CLI and obtain a token
Install Twitch CLI using https://dev.twitch.tv/docs/cli/. Authenticate the CLI with your developer application, then create a broadcaster User Access Token:
```bash
twitch token --user-token --scopes "user:read:chat channel:read:redemptions"
```
The token must belong to the broadcaster. The implementation uses the broadcaster as its installed chatbot identity. The current token scopes intentionally omit `channel:manage:redemptions`, so automatic redemption fulfillment is not enabled.

### 3. Configure environment
Copy `.env.example` to `.env` and set:
```dotenv
TWITCH_CLIENT_ID=your_client_id
TWITCH_BROADCASTER_USER_ID=123456789
TWITCH_BROADCASTER_LOGIN=your_login
TWITCH_BOT_USER_ID=123456789
TWITCH_GRAVITY_REWARD_ID=your_reward_id
TWITCH_USER_ACCESS_TOKEN=your_user_access_token
TWITCH_ENABLED=true
PORT=3000
HOST=127.0.0.1
OVERLAY_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```
Never commit `.env` or expose the token in browser code or OBS configuration. For local overlay preview without Twitch, set `TWITCH_ENABLED=false`.

### 4. Create the reward
In the broadcaster's Creator Dashboard, open Viewer Rewards → Channel Points → Manage Rewards. Create a custom reward named **Gravity Curse**. Get its exact reward ID and set `TWITCH_GRAVITY_REWARD_ID`. Activation matches the ID, not the title; all other rewards are ignored.

### 5. Start the backend
With Node.js 22+ installed:
```bash
npm install
npm start
```
Look for successful broadcaster token validation, EventSub session establishment, and registration logs for `channel.chat.message` and `channel.channel_points_custom_reward_redemption.add`.

### 6. Add the OBS Browser Source
Add a Browser Source with URL `http://localhost:3000/overlay/`. Set width/height to 1920×1080 (or 1280×720). The page background is transparent. Put the source above the gameplay/camera sources.

### 7. Flow A — chat
1. Use a second Twitch account as a test viewer.
2. Send `!curse gravity` in the broadcaster's chat.
3. Check logs for the incoming command and successful Curse Engine activation.
4. Confirm OBS immediately displays the Gravity Curse title, active indicator, animation, and countdown.
5. Wait 30 seconds. Confirm expiration is logged and the overlay returns to ready state.

### 8. Flow B — Channel Points
1. From the test viewer account, redeem the Gravity Curse reward.
2. Confirm the log includes the redemption ID and reward ID.
3. Confirm the engine activation and OBS effect/countdown.
4. Redeem an unrelated reward and confirm it does not trigger gravity.
5. Wait 30 seconds and confirm reset.
6. Under current scopes, expect Twitch to leave the redemption unfulfilled. Do not report it as fulfilled; `channel:manage:redemptions` is not requested.

### 9. Reconnection and state restoration
1. Activate the curse and refresh/reconnect the OBS Browser Source before expiry.
2. Confirm the restored timer reflects the original `expiresAt` and only the remaining time.
3. Refresh again after expiry and confirm the overlay stays inactive.
4. Confirm that reloading the overlay does not restart or extend the engine's 30-second timer.

### 10. Record the real test results
Record test date/channel, token validation, EventSub registration, chat and redemption results, 30-second expiration, overlay reconnect result, and any errors. Redact all credentials before sharing logs. Do not mark live acceptance complete until both trigger paths succeed on a real Twitch channel.

## Automated checks
```bash
npm test
npm run test:overlay
```
