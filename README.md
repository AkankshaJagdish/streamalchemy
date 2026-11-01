# StreamAlchemy

StreamAlchemy is a Twitch audience-participation MVP. Viewers can trigger a 30-second **Gravity Curse** in a streamer's OBS browser overlay by typing `!curse gravity` in chat or redeeming one configured Channel Points reward.

The MVP intentionally supports one effect and one active curse at a time. It does not control a game or modify a streamer's computer; the effect is a visible overlay animation.

## What it does

- Listens to Twitch chat through EventSub WebSocket.
- Accepts the exact `!curse gravity` command from chat.
- Listens for Channel Points custom reward redemptions and matches one configured reward by its immutable reward ID.
- Routes both triggers through the same Curse Engine.
- Displays an animated Gravity Curse card and 30-second countdown in an OBS Browser Source.
- Expires automatically after 30 seconds and restores state to idle.
- Restores the current effect and its original expiry timestamp when an overlay reconnects.
- Deduplicates EventSub chat messages and Channel Points redemption IDs.
- Redacts token/secret fields from structured logs.

## Architecture

```text
Twitch chat ─────────────┐
                         ├─ EventSub WebSocket ─ Chat / Redemption handlers
Channel Points ──────────┘                             │
                                                       ▼
                                              Curse Engine
                                        (single active 30s effect)
                                                       │
                                 ┌─────────────────────┴────────────────────┐
                                 ▼                                          ▼
                           State/events                              Expiration timer
                                 │
                                 ▼
                      Socket.IO overlay server
                                 │
                                 ▼
                      OBS Browser Source (/overlay/)
```

The backend uses Node.js ES modules. The Twitch integration validates a broadcaster User Access Token, establishes an EventSub WebSocket session, creates the two required subscriptions, handles reconnect handover/fresh-session recovery, and periodically revalidates the token. The engine owns timestamps and timer lifecycle independently of Twitch. The Socket.IO server exposes only a minimal public effect payload; it does not broadcast credentials.

## Requirements

- Node.js 22 or newer.
- npm.
- A Twitch Developer application.
- [Twitch CLI](https://dev.twitch.tv/docs/cli/) for obtaining a User Access Token.
- A Twitch broadcaster account and a custom Channel Points reward.
- OBS Studio (or another application with a browser source) for the visual demo.

## Quick start

```bash
git clone https://github.com/AkankshaJagdish/streamalchemy.git
cd streamalchemy
npm install
cp .env.example .env
# Fill in the Twitch environment variables described below.
npm start
```

Open `http://localhost:3000/health` to check the local server and `http://localhost:3000/overlay/` to preview the overlay in a browser.

## Twitch developer application setup

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Register an application and set the OAuth Redirect URL to `http://localhost:3000`.
3. Choose the application category that best fits this tool.
4. Copy the Client ID and Client Secret. Store both only in your local `.env`/Twitch CLI configuration. Never commit them or place them in browser code.

## Twitch authentication

Install Twitch CLI from the [official installation guide](https://dev.twitch.tv/docs/cli/). Configure the CLI:

```bash
twitch configure
```

Enter the application's Client ID and Client Secret when prompted. Authenticate as the broadcaster account that owns the channel, then request the broadcaster User Access Token:

```bash
twitch token --user-token --scopes "user:read:chat channel:read:redemptions"
```

Approve the consent screen and copy the User Access Token into `TWITCH_USER_ACCESS_TOKEN`. Do not use an App Access Token. StreamAlchemy validates that the token's client ID, broadcaster user ID, broadcaster login, expiry and required scopes match the configured values.

### Required scopes

| Scope | Purpose |
|---|---|
| `user:read:chat` | Read channel chat using the broadcaster-installed chatbot identity |
| `channel:read:redemptions` | Receive custom Channel Points redemption events |

The MVP intentionally does **not** request `channel:manage:redemptions`. The Gravity Curse still activates on a valid redemption, but StreamAlchemy does not automatically mark that redemption as fulfilled. This is a documented limitation rather than an implicit promise.

## EventSub configuration

No manual EventSub subscription creation is required. On startup, StreamAlchemy:

1. Validates the User Access Token.
2. Opens the Twitch EventSub WebSocket.
3. Receives the welcome session ID.
4. Registers `channel.chat.message` and `channel.channel_points_custom_reward_redemption.add` against that session.
5. Handles keepalives, Twitch reconnect handover, unexpected socket closure, fresh WebSocket sessions and subscription re-registration.

Chat subscription conditions use the broadcaster identity for both broadcaster and chat-reader user IDs in the MVP configuration. If Twitch revokes a subscription or the token becomes invalid, inspect the sanitized console logs and re-authorize/restart as needed.

## Channel Points reward setup

1. Open the broadcaster's Creator Dashboard.
2. Go to **Viewer Rewards → Channel Points → Manage Rewards**.
3. Create and save a custom reward named **Gravity Curse**.
4. Retrieve its exact reward ID using the Helix API:

```bash
curl -sS \
  -H "Client-Id: $TWITCH_CLIENT_ID" \
  -H "Authorization: Bearer $TWITCH_USER_ACCESS_TOKEN" \
  "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=$TWITCH_BROADCASTER_USER_ID"
```

Find the reward object titled `Gravity Curse` and copy its `id`. Set that exact value as `TWITCH_GRAVITY_REWARD_ID`. The handler matches the reward ID, not its title; other custom rewards are ignored.

## Environment variables

Copy `.env.example` to `.env` and provide:

| Variable | Required | Description |
|---|---:|---|
| `TWITCH_CLIENT_ID` | Yes | Twitch developer application Client ID |
| `TWITCH_CLIENT_SECRET` | No | Kept for Twitch CLI configuration; backend token validation does not need it |
| `TWITCH_BROADCASTER_USER_ID` | Yes | Numeric Twitch user ID owning the channel and authorizing the token |
| `TWITCH_BROADCASTER_LOGIN` | Yes | Twitch login for the same broadcaster |
| `TWITCH_BOT_USER_ID` | No | Defaults to broadcaster ID; MVP validation requires equality |
| `TWITCH_GRAVITY_REWARD_ID` | Recommended | Exact custom reward ID for Gravity Curse redemptions |
| `TWITCH_USER_ACCESS_TOKEN` | Yes | Broadcaster User Access Token with the required scopes |
| `TWITCH_ENABLED` | No | Defaults to enabled; set to `false` to run the overlay server without Twitch |
| `PORT` | No | HTTP port; defaults to `3000` |
| `HOST` | No | Bind interface; defaults to `0.0.0.0` |
| `OVERLAY_ALLOWED_ORIGINS` | No | Comma-separated Socket.IO browser origins; defaults include localhost ports 3000 and 5173 |

The application loads `.env` at startup through dotenv. Keep `.env` local; `.gitignore` excludes it and all other `.env.*` files except `.env.example`.

## Running the backend

```bash
npm start
```

The server starts the HTTP/Socket.IO overlay service and, unless `TWITCH_ENABLED=false`, validates Twitch authentication and connects EventSub. The health endpoint is `GET /health`. Stop with Ctrl+C; the application closes EventSub, clears engine timers and closes Socket.IO.

For local overlay-only development without Twitch credentials:

```bash
TWITCH_ENABLED=false npm start
```

## Opening the overlay and adding it to OBS

The supported OBS Browser Source URL is:

```text
http://localhost:3000/overlay/
```

In OBS:

1. Add a **Browser** source.
2. Enter the URL above.
3. Set width/height to 1920×1080 (or your canvas resolution, such as 1280×720).
4. Place the source above gameplay/camera layers.
5. Keep the page background transparent; the overlay is designed to sit over a stream scene.

The overlay shows the active curse, a title/status, progress indicator, and a countdown. It reconnects to the local Socket.IO server automatically and asks the server for its current state. On restoration it calculates remaining time from the existing `expiresAt`; it does not restart the 30-second duration.

## Usage

### Chat command

A viewer types exactly:

```text
!curse gravity
```

The command parser accepts only the supported curse allow-list. Extra arguments, unsupported names, non-command messages, oversized input and HTML/script-like content are rejected. When the curse is already active, another activation is rejected and does not reset or extend the current timer.

### Channel Points

A viewer redeems the configured **Gravity Curse** reward. The handler verifies the EventSub event type, deduplicates the redemption ID, and checks the reward ID before passing the activation request to the same engine used by chat. A redemption received while gravity is already active does not stack or extend the effect.

## Automated tests

Install dependencies, then run:

```bash
npm test
npm run test:overlay
```

Tests use Vitest and mocked Twitch/EventSub interfaces. They cover command parsing, configuration, token validation, subscription creation, chat/redemption handlers, duplicate handling, the 30-second state machine, overlay event payloads, browser rendering, reconnect restoration and mocked end-to-end chat/Channel Points flows. They do not replace testing with a real Twitch channel or OBS.

## Troubleshooting

| Symptom | Check |
|---|---|
| Startup reports missing environment variables | Confirm `.env` exists in the repository root and contains the four required values |
| Token validation fails | Re-run Twitch CLI token consent; check Client ID, broadcaster user ID/login and requested scopes |
| EventSub subscription fails | Check Twitch API response in sanitized logs, token scopes and the EventSub connection state |
| Chat command is ignored | Confirm the message is exactly `!curse gravity`, the sender is in the broadcaster's channel, and the bot/broadcaster IDs match |
| Channel Points redemption is ignored | Verify the configured reward ID; matching is by ID and other rewards are intentionally ignored |
| Overlay page opens but does not connect | Ensure the backend is running, use `http://localhost:3000/overlay/`, and check `OVERLAY_ALLOWED_ORIGINS` |
| Overlay countdown restarts unexpectedly | Refresh after reproducing and inspect the server's `curse:state` restoration timestamp; the expected behavior uses original `expiresAt` |
| Redemption remains pending | Expected with the current minimum scope set; auto-fulfillment requires an additional `channel:manage:redemptions` permission that this MVP does not request |
| Port is already in use | Set `PORT` to another available port and update the OBS Browser Source URL |

## Manual live acceptance test

Before calling the real Twitch integration verified, complete both flows with a real broadcaster and a separate viewer account:

1. Start the app and confirm token validation and both EventSub subscriptions.
2. Add the Browser Source to OBS.
3. Send `!curse gravity` from the viewer account; verify the visible countdown and 30-second expiry.
4. Redeem the configured Gravity Curse reward; verify the same effect and expiry.
5. Try another reward ID; verify it does not activate the curse.
6. Refresh the Browser Source mid-effect; verify that it resumes at the original expiry time.
7. Record the results and any sanitized errors for the submission.

## Project scope and known limitations

This draft deliberately keeps the chosen MVP scope. It has one visual effect (Gravity Curse), no stacking/queue, one configured Channel Points reward, and no automatic redemption fulfillment. It is an OBS browser overlay rather than a reviewed Twitch Extension. The real Twitch and OBS acceptance test must be completed on the target channel before the project is described as fully verified.
