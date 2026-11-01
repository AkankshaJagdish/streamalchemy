export const CURSE_STATES = Object.freeze({
  IDLE: 'IDLE',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED'
});

function cloneEffect(effect) {
  return effect ? Object.freeze({ ...effect }) : null;
}

/**
 * Owns the authoritative observable curse state.
 *
 * subscribe(listener) immediately supplies the current snapshot and returns
 * an unsubscribe function. All listeners receive immutable snapshots.
 */
export function createStateManager({ initialState = CURSE_STATES.IDLE } = {}) {
  if (!Object.values(CURSE_STATES).includes(initialState)) {
    throw new TypeError(`Invalid initial curse state: ${initialState}`);
  }

  let state = initialState;
  let activeEffect = null;
  const listeners = new Set();

  function getSnapshot() {
    return Object.freeze({
      state,
      activeEffect: cloneEffect(activeEffect)
    });
  }

  function publish() {
    const snapshot = getSnapshot();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        // An observer must not interrupt the engine's authoritative transition.
        queueMicrotask(() => { throw error; });
      }
    }
    return snapshot;
  }

  return Object.freeze({
    getState: () => state,
    getActiveEffect: () => cloneEffect(activeEffect),
    getSnapshot,
    setActive(effect) {
      if (state === CURSE_STATES.ACTIVE) {
        throw new Error('Cannot replace an active curse effect');
      }
      if (!effect || typeof effect !== 'object') {
        throw new TypeError('An effect object is required');
      }
      activeEffect = { ...effect };
      state = CURSE_STATES.ACTIVE;
      return publish();
    },
    expire() {
      if (state !== CURSE_STATES.ACTIVE || !activeEffect) {
        return null;
      }
      const expiredEffect = cloneEffect(activeEffect);
      activeEffect = null;
      state = CURSE_STATES.IDLE;
      publish();
      return expiredEffect;
    },
    reset() {
      activeEffect = null;
      state = CURSE_STATES.IDLE;
      return publish();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('State subscriber must be a function');
      }
      listeners.add(listener);
      listener(getSnapshot());
      return () => listeners.delete(listener);
    },
    getSubscriberCount: () => listeners.size
  });
}
