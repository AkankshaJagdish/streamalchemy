# StreamAlchemy — Twitch Gravity Curse MVP

## Live Twitch and OBS test procedure

Automated integration tests mock Twitch/EventSub. They verify the software flow but cannot prove the live Twitch authorization or OBS environment. Use this procedure for the real-channel acceptance test.

### 1. Register a Twitch developer application
1. Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and register an application.
2. Set the OAuth Redirect URL to **http://localhost:3000**. Twitch CLI uses this callback when requesting a User Access Token.
3. Choose the application category that best describes the tool and create an app with a Client ID and Client Secret.
4. Keep the Client Secret private. It is used by Twitch CLI configuration and backend only; it is never sent to the overlay.

### 2. Configure Twitch CLI and obtain a broadcaster token
Install [Twitch CLI](https://dev.twitch.tv/docs/cli/), then configure it with your application:
\`\`\`bash
twitch configure
\`\`\`
Enter the Client ID and Client Secret when prompted. Then log in to Twitch as the broadcaster account that owns the channel, and run:
\`\`\`bash
twitch token --user-token --scopes "user:read:chat channel:read:redemptions"
\`\`\`
Approve the consent screen. Copy the **User Access Token** into your backend environment (not the refresh token). The token must belong to the broadcaster for this installed-chatbot configuration. Twitch CLI requires the registered app's redirect URL to be \`http://localhost:3000\` for User Access Token consent.

The current scope set intentionally omits \`channel:manage:redemptions\`; StreamAlchemy receives Channel Points events but will not automatically mark redemptions fulfilled.

### 3. Find the broadcaster's numeric user ID
After setting the Client ID and token as shell variables, query Helix Users:
\`\`\`bash
export TWITCH_CLIENT_ID="your_client_id"
export TWITCH_USER_ACCESS_TOKEN="your_broadcaster_user_token"
export TWITCH_BROADCASTER_LOGIN="your_channel_login"
curl -sS -H "Client-Id: $TWITCH_CLIENT_ID" \\
  -H "Authorization: Bearer $TWITCH_USER_ACCESS_TOKEN" \\
  "https://api.twitch.tv/helix/users?login=$TWITCH_BROADCASTER_LOGIN"
\`\`\`
Use the returned \`data[0].id\` as \`TWITCH_BROADCASTER_USER_ID\`. The login and user ID must refer to the account that authorized the token.

### 4. Create the Gravity Curse reward and retrieve its ID
1. In the broadcaster's Creator Dashboard, open **Viewer Rewards → Channel Points → Manage Rewards**.
2. Create a custom reward titled **Gravity Curse** and save it.
3. Query the custom reward list using the same broadcaster token:
\`\`\`bash
curl -sS -H "Client-Id: $TWITCH_CLIENT_ID" \\
  -H "Authorization: Bearer $TWITCH_USER_ACCESS_TOKEN" \\
  "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=YOUR_BROADCASTER_USER_ID"
\`\`\`
4. Find the reward object whose \`title\` is \`Gravity Curse\` and copy its \`id\`. Set it as \`TWITCH_GRAVITY_REWARD_ID\`. The application matches this exact ID, not the title; other reward IDs are ignored.

### 5. Set environment variables
Copy \`.env.example\` to \`.env\` in the repository root. Fill in:
\`\`\`dotenv
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_BROADCASTER_USER_ID=your_numeric_user_id
TWITCH_BROADCASTER_LOGIN=your_channel_login
TWITCH_BOT_USER_ID=your_numeric_user_id
TWITCH_GRAVITY_REWARD_ID=your_gravity_reward_id
TWITCH_USER_ACCESS_TOKEN=your_broadcaster_user_access_token
TWITCH_ENABLED=true
PORT=3000
HOST=127.0.0.1
OVERLAY_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
\`\`\`
For this MVP's installed-chatbot mode, \`TWITCH_BOT_USER_ID\` defaults to the broadcaster ID. Do not commit \`.env\` or paste secrets into chat, browser code, OBS, or screenshots. The server loads \`.env\` at startup.

### 6. Install dependencies and start
Use Node.js 22 or newer:
\`\`\`bash
npm install
npm start
\`\`\`
Check the terminal for:
- Successful Twitch token validation.
- EventSub WebSocket session establishment.
- Registration of \`channel.chat.message\`.
- Registration of \`channel.channel_points_custom_reward_redemption.add\`.

### 7. Add the overlay as an OBS Browser Source
1. In OBS, add a Browser Source.
2. Set the URL to \`http://localhost:3000/overlay/\`.
3. Set dimensions to 1920×1080 (or 1280×720).
4. Place the Browser Source above gameplay/camera sources. Its page background is transparent.

### 8. Flow A — chat
1. Use a second Twitch account as a test viewer.
2. Send exactly \`!curse gravity\` in the broadcaster's chat.
3. Confirm logs show the incoming chat command and successful Curse Engine activation.
4. Confirm OBS immediately shows the Gravity Curse title, active indicator, animated gravity field, and countdown.
5. Let 30 seconds elapse. Confirm expiration is logged and the overlay returns to its ready state.

### 9. Flow B — Channel Points
1. From the test viewer account, redeem the **Gravity Curse** reward.
2. Confirm logs show the redemption ID and reward ID.
3. Confirm the same Gravity Curse Engine state and overlay animation/countdown activate.
4. Redeem another custom reward with a different reward ID; confirm it does not activate gravity.
5. Let 30 seconds elapse and confirm the overlay resets.
6. Under the current scopes, expect the redemption to remain pending/unfulfilled. Automatic fulfillment is not enabled because \`channel:manage:redemptions\` is not requested.

### 10. Reconnection and recording
1. Activate the curse and refresh/reconnect the OBS Browser Source before it expires.
2. Confirm the browser receives the active state with the original \`expiresAt\` and shows only the remaining time; it must not start a fresh 30-second timer.
3. Refresh after expiry and confirm the overlay stays inactive.
4. Record the date/channel, token validation, subscription registrations, both flow outcomes, expiration, reconnect result, and any sanitized error output. Do not call the real-channel acceptance criterion complete until both flows have been exercised live.

## Automated checks
\`\`\`bash
npm test
npm run test:overlay
\`\`\`
