import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCurseEngine } from '../src/engine/curseEngine.js';
import { CURSE_STATES } from '../src/engine/stateManager.js';

describe('Curse Engine', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000 }));
  afterEach(() => vi.useRealTimers());

  it('starts idle', () => {
    const engine = createCurseEngine();
    expect(engine.getState()).toBe(CURSE_STATES.IDLE);
    expect(engine.getActiveEffect()).toBeNull();
    engine.shutdown();
  });

  it('activates gravity with the canonical 30-second duration', () => {
    const engine = createCurseEngine();
    const result = engine.activate({ curse: 'gravity', source: 'twitch-chat' });

    expect(result.activated).toBe(true);
    expect(result.effect).toEqual({
      id: 'gravity',
      name: 'Gravity Curse',
      duration: 30_000,
      startedAt: 1_000,
      expiresAt: 31_000
    });
    expect(engine.getState()).toBe(CURSE_STATES.ACTIVE);
    engine.shutdown();
  });

  it('expires after exactly 30 seconds and returns to idle', () => {
    const onEvent = vi.fn();
    const engine = createCurseEngine({ onEvent });
    engine.activate({ curse: 'gravity', source: 'channel-points' });

    vi.advanceTimersByTime(29_999);
    expect(engine.getState()).toBe(CURSE_STATES.ACTIVE);
    vi.advanceTimersByTime(1);

    expect(engine.getState()).toBe(CURSE_STATES.IDLE);
    expect(engine.getActiveEffect()).toBeNull();
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['activated', 'expired']);
    engine.shutdown();
  });

  it('does not stack or reset the timer on duplicate activation', () => {
    const onEvent = vi.fn();
    const engine = createCurseEngine({ onEvent });
    const first = engine.activate({ curse: 'gravity' });
    vi.advanceTimersByTime(10_000);
    const second = engine.activate({ curse: 'gravity' });

    expect(second).toMatchObject({ activated: false, reason: 'already-active' });
    expect(engine.getActiveEffect().startedAt).toBe(first.effect.startedAt);
    vi.advanceTimersByTime(20_000);
    expect(engine.getState()).toBe(CURSE_STATES.IDLE);
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['activated', 'expired']);
    engine.shutdown();
  });

  it('rejects unknown curses and invalid durations', () => {
    const engine = createCurseEngine();
    expect(engine.activate({ curse: 'ice' })).toMatchObject({
      activated: false, reason: 'unsupported-curse'
    });
    expect(engine.activate({ curse: 'gravity', durationMs: 5_000 })).toMatchObject({
      activated: false, reason: 'invalid-duration'
    });
    expect(engine.getState()).toBe(CURSE_STATES.IDLE);
    engine.shutdown();
  });

  it('clears timer and cooldown on shutdown', () => {
    const engine = createCurseEngine();
    engine.activate({ curse: 'gravity' });
    engine.shutdown();

    expect(engine.getState()).toBe(CURSE_STATES.IDLE);
    expect(engine.getActiveEffect()).toBeNull();
    expect(engine.isShutdown()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(engine.activate({ curse: 'gravity' })).toMatchObject({
      activated: false, reason: 'engine-shutdown'
    });
  });

  it('emits activation and expiration events with observable snapshots', () => {
    const events = [];
    const snapshots = [];
    const engine = createCurseEngine({ onEvent: (event) => events.push(event) });
    const unsubscribe = engine.subscribe((snapshot) => snapshots.push(snapshot));

    engine.activate({ curse: 'gravity', source: 'twitch-chat' });
    vi.advanceTimersByTime(30_000);

    expect(events[0]).toMatchObject({
      type: 'activated',
      effect: { id: 'gravity', duration: 30_000 },
      snapshot: { state: CURSE_STATES.ACTIVE }
    });
    expect(events[1]).toMatchObject({
      type: 'expired',
      effect: { id: 'gravity' },
      snapshot: { state: CURSE_STATES.IDLE }
    });
    expect(snapshots.map((item) => item.state)).toEqual([
      CURSE_STATES.IDLE, CURSE_STATES.ACTIVE, CURSE_STATES.IDLE
    ]);
    unsubscribe();
    engine.shutdown();
  });

  it('uses injected clock and timer abstractions', () => {
    let clock = 50;
    let scheduled;
    let cleared = false;
    const engine = createCurseEngine({
      now: () => clock,
      timer: {
        setTimeout: (callback, delay) => {
          scheduled = { callback, delay };
          return scheduled;
        },
        clearTimeout: (handle) => {
          if (handle === scheduled) cleared = true;
        }
      }
    });

    const result = engine.activate({ curse: 'gravity' });
    expect(result.effect.startedAt).toBe(50);
    expect(result.effect.expiresAt).toBe(30_050);
    expect(scheduled.delay).toBe(30_000);
    clock = 30_050;
    scheduled.callback();
    expect(engine.getState()).toBe(CURSE_STATES.IDLE);
    expect(cleared).toBe(true);
    engine.shutdown();
  });
});
