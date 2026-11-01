# Curse Engine API

The Curse Engine is independent of Twitch, Express, Socket.IO and the browser overlay. It owns the authoritative curse state.

## Create and activate

```js
import { createCurseEngine } from '../src/engine/curseEngine.js';

const engine = createCurseEngine({
  onEvent(event) {
    // event.type is "activated" or "expired".
    console.log(event.type, event.effect.id, event.snapshot.state);
  }
});

const result = engine.activate({
  curse: 'gravity',
  source: 'twitch-chat' // or "channel-points"
});
```

Gravity always uses the trusted definition's 30,000 ms duration. An input duration is optional; if supplied, it must equal 30,000 ms. The engine never accepts a viewer-provided duration as authority.

While gravity is active, a further activation returns:

```js
{ activated: false, reason: 'already-active' }
```

The existing timer is not reset and no overlapping effect is created.

## Observe state

```js
const snapshot = engine.getSnapshot();
// { state: "IDLE" | "ACTIVE", activeEffect: object | null }

const unsubscribe = engine.subscribe((snapshot) => {
  // Called immediately, then on each state transition.
});
```

An active effect has the shape:

```js
{
  id: 'gravity',
  name: 'Gravity Curse',
  duration: 30000,
  startedAt: 0,
  expiresAt: 30000
}
```

After expiration the engine clears the effect and emits an `expired` event. Observable state returns to `IDLE`. `EXPIRED` is a lifecycle result represented by the expiration event; it is not retained as a steady state.

## Shutdown

Call `engine.shutdown()` during application shutdown. It clears the scheduled timer, cooldown guard and active state. Further activations return `engine-shutdown`.

## Testability

Pass `now` and `timer.setTimeout/clearTimeout` to `createCurseEngine` to use a deterministic clock and timer implementation.
