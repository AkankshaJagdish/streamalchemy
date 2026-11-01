import { describe, expect, it, vi } from 'vitest';
import { createStateManager, CURSE_STATES } from '../src/engine/stateManager.js';

const effect = {
  id: 'gravity',
  name: 'Gravity Curse',
  duration: 30_000,
  startedAt: 1000,
  expiresAt: 31_000
};

describe('state manager', () => {
  it('starts idle with no active effect', () => {
    const manager = createStateManager();
    expect(manager.getSnapshot()).toEqual({
      state: CURSE_STATES.IDLE,
      activeEffect: null
    });
  });

  it('publishes active then idle snapshots to subscribers', () => {
    const manager = createStateManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    manager.setActive(effect);
    manager.expire();

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[1][0]).toMatchObject({
      state: CURSE_STATES.ACTIVE,
      activeEffect: effect
    });
    expect(listener.mock.calls[2][0]).toEqual({
      state: CURSE_STATES.IDLE,
      activeEffect: null
    });
    unsubscribe();
    expect(manager.getSubscriberCount()).toBe(0);
  });

  it('does not mutate state through a returned snapshot', () => {
    const manager = createStateManager();
    manager.setActive(effect);
    const snapshot = manager.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.activeEffect)).toBe(true);
    expect(() => { snapshot.activeEffect.name = 'changed'; }).toThrow();
    expect(manager.getActiveEffect().name).toBe('Gravity Curse');
  });

  it('rejects replacing an active effect', () => {
    const manager = createStateManager();
    manager.setActive(effect);
    expect(() => manager.setActive(effect)).toThrow(/active curse/i);
  });

  it('returns null when expiring while already idle', () => {
    const manager = createStateManager();
    expect(manager.expire()).toBeNull();
  });

  it('rejects invalid subscribers', () => {
    const manager = createStateManager();
    expect(() => manager.subscribe(null)).toThrow(TypeError);
  });
});
