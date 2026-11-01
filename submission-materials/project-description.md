# StreamAlchemy — project description

## Summary
StreamAlchemy turns a Twitch audience into active participants in a live stream. A viewer can trigger a visible 30-second Gravity Curse either by entering `!curse gravity` in chat or by redeeming the broadcaster's configured Gravity Curse Channel Points reward. Both paths feed one shared effect engine, and an OBS browser overlay displays the effect and counts down until it expires.

## The experience
Chat is often a stream's audience, but not part of the action. StreamAlchemy gives viewers a simple, bounded way to influence what appears on screen. The broadcaster can react to the effect in real time, while viewers see a clear acknowledgement of their participation.

## Features
- Twitch EventSub WebSocket listener for chat messages and Channel Points custom reward redemptions.
- Exact chat command parsing and allow-list validation for Gravity Curse.
- Exact Channel Points reward-ID matching.
- One shared Curse Engine and one active-effect state at a time.
- Fixed 30-second duration controlled by trusted application configuration.
- OBS browser overlay with animated Gravity Curse visuals, countdown and progress.
- Automatic expiry and idle-state restoration.
- Overlay reconnect state sync with original timestamps.
- Duplicate event handling and structured logs with secret redaction.

## How it works
Twitch EventSub notifications are routed to dedicated chat and redemption handlers. Each handler validates the event and source-specific conditions before requesting activation from the Curse Engine. The engine creates the authoritative effect timestamps and timer. State and lifecycle events are broadcast through Socket.IO to the OBS browser overlay. When the expiry timer fires, the engine returns to idle; a reconnecting overlay receives the current state and original expiry timestamp.

## Technology
Node.js 22, Express, Socket.IO, WebSocket (`ws`), Twitch EventSub and a plain HTML/CSS/JavaScript OBS browser overlay. The project includes automated Vitest unit and mocked integration tests.

## Use of Codex
StreamAlchemy was developed in Codex through an iterative build process: establishing the narrow product scope, implementing the Curse Engine and Twitch EventSub handlers, building the OBS overlay, adding mocked end-to-end tests, reviewing configuration and secret handling, and preparing the developer and submission documentation. In the demonstration, show the actual Codex thread, a representative prompt, and a real code diff from the build. Retrieve the Codex session ID from the primary Codex thread using `/status`; it is intentionally not included here because it must come from the actual session.

## Judging criteria fit
- **Innovation/Idea:** A concise audience-participation interaction combining chat and Channel Points into a single visible stream effect.
- **Potential Impact:** Provides streamers with a lightweight way to turn audience activity into an on-screen moment and reaction.
- **Technological implementation:** Uses EventSub, token validation, a shared state machine, reconnect handling, timer cleanup, tests and safe configuration.
- **Design:** A transparent OBS overlay with a designed Gravity Curse card, animation, progress indicator and clear countdown.

## Current scope and limitations
The MVP intentionally includes one curse, one active effect at a time and one configured Channel Points reward. The current Twitch token scopes do not include `channel:manage:redemptions`, so redemptions trigger the effect but are not automatically marked fulfilled. The software has mocked Twitch/EventSub tests; real broadcaster/viewer and OBS acceptance testing is a separate requirement and has not been represented as complete.
