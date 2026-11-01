# StreamAlchemy — three-minute demonstration script

**Target runtime:** 2:50 (under the three-minute maximum)  
**Recording rule:** Use only your own Twitch channel/account footage, your own OBS scene and project assets, and music/audio you created or are licensed to use. Avoid third-party game footage, streamer identities, logos, copyrighted music or other assets unless you have permission. Record only after the live acceptance test succeeds.

| Time | Picture / action | Narration |
|---|---|---|
| 0:00–0:12 | Open on the actual Twitch channel page and the live stream with chat visible. Keep the streamer's camera/game scene and chat legible. | “StreamAlchemy lets Twitch chat trigger a live on-screen curse. Viewers can play along, and the streamer sees the effect immediately.” |
| 0:12–0:30 | Show OBS with the StreamAlchemy Browser Source layered over the stream. Show the channel chat and overlay in the same shot. | “The Gravity Curse is deliberately simple: one supported effect, a fixed 30-second duration, and a clear countdown.” |
| 0:30–0:58 | From a separate viewer account, type `!curse gravity` in the actual channel chat. Hold on the real message, then show the overlay activate and the streamer react. | “A viewer enters the chat command. EventSub delivers the message, StreamAlchemy validates it, and the shared Curse Engine activates Gravity.” |
| 0:58–1:18 | Keep the active overlay visible. Capture the countdown moving through several seconds. Show the scene animation clearly. | “The overlay is not a simulated video: it is a browser source connected to the running backend. The timer uses the engine's expiry timestamp.” |
| 1:18–1:30 | Let the timer reach zero. Show the overlay return to its idle state. | “After 30 seconds, the effect expires automatically and the overlay resets.” |
| 1:30–1:58 | From the viewer account, redeem the actual configured Gravity Curse Channel Points reward. Show the redemption in Twitch and the same overlay effect activating. | “The second route is Channel Points. EventSub receives the custom reward redemption, the handler checks its exact reward ID, and it uses the same engine and overlay path.” |
| 1:58–2:10 | Show the countdown and a quick overlay reconnect or browser-source refresh while active. | “A reconnect restores the active state from the original expiry timestamp, rather than granting a fresh 30 seconds.” |
| 2:10–2:38 | Switch to the actual Codex development thread. Show a representative prompt and the corresponding source diff, then browse briefly through the engine, EventSub integration and tests. Do not display secrets. | “Codex helped build and refine the Node.js backend, EventSub integration, effect state machine, OBS overlay and automated tests. The important implementation decision is that chat and Channel Points both enter one controlled activation path.” |
| 2:38–2:50 | Show the repository README and the running overlay one last time. End on the actual channel. | “StreamAlchemy makes the audience part of the stream, one small moment of chaos at a time.” |

## Capture checklist
- Record the actual Twitch channel and visible chat; do not use mock screenshots as live proof.
- Record the OBS Browser Source rendering the running application.
- Capture both real triggers and the 30-second expiration in the same coherent demo.
- Capture Codex thread work and a genuine code change/diff from the project.
- Avoid showing `.env`, tokens, Client Secret, account dashboards containing private details, or browser DevTools with credentials.
- Use screen capture/audio/visual assets you own or have permission to use.
- Keep the exported video under 3:00; target 2:50 to leave an editing buffer.
- Retrieve the real Codex session ID using `/status` in the primary Codex thread and enter it in the submission form, not in this repository until it is intentionally verified.
