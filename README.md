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

When `TWITCH_CHANNEL_POINTS_ENABLED=false`, only `user:read:chat` is required and the Channel Points subscription is not registered. The redemption handler and Channel Points integration remain in the codebase and are enabled by default. The MVP intentionally does **not** request `channel:manage:redemptions`. When Channel Points are enabled, the Gravity Curse still activates on a valid redemption, but StreamAlchemy does not automatically mark that redemption as fulfilled. This is a documented limitation rather than an implicit promise.

## EventSub configuration

No manual EventSub subscription creation is required. On startup, StreamAlchemy:

1. Validates the User Access Token against the scopes required by the enabled triggers.
2. Opens the Twitch EventSub WebSocket.
3. Receives the welcome session ID.
4. Registers `channel.chat.message` and, when `TWITCH_CHANNEL_POINTS_ENABLED=true`, `channel.channel_points_custom_reward_redemption.add` against that session.
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
| `TWITCH_GRAVITY_REWARD_ID` | Recommended when Channel Points are enabled | Exact custom reward ID for Gravity Curse redemptions |
| `TWITCH_CHANNEL_POINTS_ENABLED` | No | Defaults to `true`; set to `false` for a real chat-only demo that does not require Channel Points eligibility or redemption scope |
| `TWITCH_USER_ACCESS_TOKEN` | Yes | Broadcaster User Access Token with the required scopes |
| `TWITCH_ENABLED` | No | Defaults to enabled; set to `false` to run the overlay server without Twitch |
| `TWITCH_CHANNEL_POINTS_ENABLED` | No | Defaults to `true`; set to `false` for chat-only live testing without Channel Points scope or subscription |
| `PORT` | No | HTTP port; defaults to `3000` |
| `HOST` | No | Bind interface; defaults to `0.0.0.0` |
| `OVERLAY_ALLOWED_ORIGINS` | No | Comma-separated Socket.IO browser origins; defaults include localhost ports 3000 and 5173 |

The application loads `.env` at startup through dotenv. Keep `.env` local; `.gitignore` excludes it and all other `.env.*` files except `.env.example`.

## Running the backend

```bash
npm start
```

The server starts the HTTP/Socket.IO overlay service and, unless `TWITCH_ENABLED=false`, validates Twitch authentication and connects EventSub. Channel Points are enabled by default. For a chat-only live demo on a channel without Channel Points eligibility, set `TWITCH_CHANNEL_POINTS_ENABLED=false`; StreamAlchemy then validates only `user:read:chat` and registers only `channel.chat.message`. The health endpoint is `GET /health`. Stop with Ctrl+C; the application closes EventSub, clears engine timers and closes Socket.IO.

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

Set `TWITCH_EVENTSUB_MODE=production` (or omit it, since production is the default), provide the required production Twitch configuration and a real Gravity Curse reward ID, and remove the mock URL setting. Do not deploy with mock mode enabled. Production mode retains Twitch token validation and the production EventSub URL. Channel Points remain enabled by default; set `TWITCH_CHANNEL_POINTS_ENABLED=false` to validate and register chat only.

**Important:** this is a simulated EventSub notification test only. It does not test a real Channel Points redemption, does not create a reward on Twitch, and does not establish eligibility for Channel Points. A real redemption still requires a channel eligible for Channel Points (Affiliate or Partner) and a separately completed live Twitch/OBS acceptance test.

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


## Deploying on Caasify Docker Container Hosting

This deployment uses the repository's Dockerfile and keeps the existing single-process application architecture. Deploy only one application replica: the Curse Engine and Twitch EventSub session are in-memory and must not be split across instances.

1. In Caasify, choose **Docker Container Hosting** and create one container application.
2. Connect the GitHub repository `AkankshaJagdish/streamalchemy`. After this deployment-preparation pull request is merged, select branch `main`.
3. Select **Build from Dockerfile**, with the repository root as the build context and `Dockerfile` as the Dockerfile path. The image runs the existing `npm start` command.
4. Configure the runtime environment variables listed below using Caasify's encrypted environment-variable/secret settings. Do not put credentials in the Dockerfile, Git repository, browser code, build arguments, or container image.
5. Assign the public HTTPS domain. Once Caasify displays the final hostname, set `OVERLAY_ALLOWED_ORIGINS` to its exact origin, for example `https://YOUR-CAASIFY-DOMAIN`. Use the scheme and hostname only: no path, query string, or trailing slash.
6. Set the platform health-check path to `/health`. The application responds with HTTP 200 and `{"ok":true}` when the HTTP server is running.
7. Set **minimum replicas = 1** and **maximum replicas = 1**. Disable autoscaling beyond one instance and disable **scale-to-zero**.
8. Configure the container's `PORT` from the port assigned/configured by Caasify. The application reads `process.env.PORT`; it falls back to `3000` only when no `PORT` is supplied. Set `HOST=0.0.0.0` so the HTTP server is reachable through the container ingress.
9. Deploy and inspect the build and runtime logs. Confirm startup, Twitch token validation, and both EventSub subscription registrations. Logs must not contain access tokens or client secrets.
10. Open `https://YOUR-CAASIFY-DOMAIN/health` and confirm HTTP 200. Then open `https://YOUR-CAASIFY-DOMAIN/overlay/`.
11. Add `https://YOUR-CAASIFY-DOMAIN/overlay/` as the OBS Browser Source URL. Keep the Browser Source connected to the same public service.
12. Complete the public Socket.IO test below before treating the deployment as accepted.

### Caasify runtime environment

Set these values in the Caasify runtime configuration, not in source files:

| Variable | Required | Value |
|---|---:|---|
| `TWITCH_CLIENT_ID` | Yes | Twitch Developer Application Client ID |
| `TWITCH_BROADCASTER_USER_ID` | Yes | Numeric ID of the broadcaster who authorized the token |
| `TWITCH_BROADCASTER_LOGIN` | Yes | Login of that same broadcaster |
| `TWITCH_USER_ACCESS_TOKEN` | Yes | Broadcaster User Access Token with `user:read:chat` and `channel:read:redemptions` |
| `TWITCH_GRAVITY_REWARD_ID` | Required for Channel Points | Exact ID of the manually created Gravity Curse reward |
| `TWITCH_ENABLED` | Recommended | `true` |
| `HOST` | Yes for container ingress | `0.0.0.0` |
| `PORT` | Platform-dependent | Use the internal port Caasify assigns or configures; do not replace it with an unrelated fixed value |
| `OVERLAY_ALLOWED_ORIGINS` | Yes for the public overlay | `https://YOUR-CAASIFY-DOMAIN` (exact origin, no trailing slash or path) |

`TWITCH_BOT_USER_ID` is optional and defaults to `TWITCH_BROADCASTER_USER_ID`. `TWITCH_CLIENT_SECRET` is not required by the running backend; it is used when configuring the Twitch CLI locally. Do not add it to the container unless a separately reviewed operational need arises. The app's `.env.example` remains the reference for all supported settings.

Caasify advertises a usage-price offer of €0 through December 31, 2026, with standard usage pricing resuming in 2027. Public material lists CPU, memory, storage, and outbound traffic as separately metered resources. Confirm the actual offer eligibility, selected region, resource allocation, storage/traffic charges, and account-specific terms in your Caasify dashboard before deploying; this repository cannot inspect your private account or confirm the dashboard's current balance/entitlements. See the [Caasify Docker Container Hosting page](https://caasify.com/container-hosting).

### Public Socket.IO / WebSocket acceptance test

Docker deployment, HTTPS, and a healthy `/health` response do not prove that the ingress forwards WebSocket upgrades. The current application uses the standard Socket.IO path `/socket.io/` on the same HTTP server as the overlay. The browser client attempts WebSocket and has HTTP long-polling available as a transport fallback.

After deployment:

1. Open browser developer tools on `https://YOUR-CAASIFY-DOMAIN/overlay/` and inspect the Network panel.
2. Confirm the Socket.IO connection reaches the public hostname. Check whether the transport is `websocket` (an HTTP Upgrade request with status 101) or whether it remains on `polling` requests.
3. If it uses polling, record that result; do not describe WebSocket as working. If the connection fails, capture the sanitized browser/network error and Caasify ingress logs.
4. Keep the overlay open for at least 30–60 minutes. Confirm the connection remains stable and the service does not restart.
5. Check Caasify's instance/replica history during the same interval. Confirm exactly one replica remains running and that scale-to-zero has not stopped it.
6. Only after transport stability is established, test a real chat command, a real configured Channel Points redemption, the 30-second expiry, and overlay refresh/reconnection.

**WebSocket ingress support is not yet verified for this application.** Caasify's public Docker-hosting material describes Dockerfile builds, public HTTPS domains, health checks, logs, monitoring, and replica controls, but the material reviewed does not establish Socket.IO/WebSocket upgrade behavior for this deployment. Treat the public connection test as a release gate. If WebSocket is rejected or unstable, stop and report the observed result; do not replace Socket.IO or alter the application architecture as a workaround.

### Single-instance operating rule

Keep this service at exactly one replica for its entire lifetime: minimum 1, maximum 1, scale-to-zero disabled. Do not add a second backend service, horizontal scaling, Redis, a database, or distributed state. Multiple instances would each own independent in-memory curse timers and could create multiple Twitch EventSub sessions.

## Project scope and known limitations

This draft deliberately keeps the chosen MVP scope. It has one visual effect (Gravity Curse), no stacking/queue, one configured Channel Points reward, and no automatic redemption fulfillment. It is an OBS browser overlay rather than a reviewed Twitch Extension. The real Twitch and OBS acceptance test must be completed on the target channel before the project is described as fully verified.
