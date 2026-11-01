import { CURSE_DEFINITIONS, getCurseDefinition } from './curseDefinitions.js';
import { createStateManager, CURSE_STATES } from './stateManager.js';
import { createCooldownManager } from './cooldownManager.js';

const VALID_SOURCES = new Set(['twitch-chat', 'channel-points']);

function createDefaultTimer() {
  return {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (handle) => clearTimeout(handle)
  };
}

export function createCurseEngine({
  now = Date.now,
  timer = createDefaultTimer(),
  stateManager = createStateManager(),
  onEvent = () => {},
  logger = null
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!timer || typeof timer.setTimeout !== 'function' || typeof timer.clearTimeout !== 'function') {
    throw new TypeError('timer must provide setTimeout and clearTimeout');
  }
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');

  const cooldown = createCooldownManager({ now });
  let expirationTimer = null;
  let shutdown = false;
  let lastTransition = null;

  function emit(type, effect) {
    const event = Object.freeze({
      type,
      effect: Object.freeze({ ...effect }),
      snapshot: stateManager.getSnapshot(),
      timestamp: now()
    });
    lastTransition = event;
    try {
      onEvent(event);
    } catch (error) {
      logger?.error?.('Curse Engine event listener failed', { message: error.message });
    }
    return event;
  }

  function clearExpirationTimer() {
    if (expirationTimer !== null) {
      timer.clearTimeout(expirationTimer);
      expirationTimer = null;
    }
  }

  function expire(expectedEffectId) {
    if (shutdown) return false;
    const active = stateManager.getActiveEffect();
    if (!active || active.id !== expectedEffectId) return false;

    clearExpirationTimer();
    cooldown.clear();
    const expiredEffect = stateManager.expire();
    if (!expiredEffect) return false;
    emit('expired', expiredEffect);
    return true;
  }

  function activate(request) {
    if (shutdown) return { activated: false, reason: 'engine-shutdown' };
    if (!request || typeof request !== 'object') {
      return { activated: false, reason: 'invalid-request' };
    }

    const curseName = typeof request.curse === 'string' ? request.curse.toLowerCase() : '';
    const definition = getCurseDefinition(curseName);
    if (!definition) return { activated: false, reason: 'unsupported-curse' };

    if (request.durationMs !== undefined && request.durationMs !== definition.durationMs) {
      return { activated: false, reason: 'invalid-duration' };
    }
    if (request.source !== undefined && !VALID_SOURCES.has(request.source)) {
      return { activated: false, reason: 'invalid-source' };
    }

    const current = stateManager.getActiveEffect();
    if (current || cooldown.isActive()) {
      return { activated: false, reason: 'already-active', activeEffect: current };
    }

    const startedAt = now();
    const expiresAt = startedAt + definition.durationMs;
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt)) {
      return { activated: false, reason: 'invalid-clock' };
    }

    const effect = Object.freeze({
      id: definition.name,
      name: definition.displayName,
      duration: definition.durationMs,
      startedAt,
      expiresAt
    });

    let stateWasSet = false;
    try {
      stateManager.setActive(effect);
      stateWasSet = true;
      expirationTimer = timer.setTimeout(() => expire(effect.id), definition.durationMs);
      cooldown.start(expiresAt);
      emit('activated', effect);
      return { activated: true, effect, snapshot: stateManager.getSnapshot() };
    } catch (error) {
      clearExpirationTimer();
      cooldown.clear();
      if (stateWasSet) stateManager.reset();
      logger?.error?.('Curse Engine activation failed', { message: error.message });
      return { activated: false, reason: 'activation-failed' };
    }
  }

  function shutdownEngine() {
    if (shutdown) return;
    shutdown = true;
    clearExpirationTimer();
    cooldown.clear();
    stateManager.reset();
  }

  return Object.freeze({
    activate,
    subscribe: stateManager.subscribe,
    getSnapshot: stateManager.getSnapshot,
    getState: stateManager.getState,
    getActiveEffect: stateManager.getActiveEffect,
    getLastEvent: () => lastTransition,
    shutdown: shutdownEngine,
    isShutdown: () => shutdown,
    supportedCurses: Object.freeze(Object.values(CURSE_DEFINITIONS).map((item) => item.name)),
    states: CURSE_STATES
  });
}
