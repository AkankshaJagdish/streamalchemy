export const OVERLAY_EVENTS = Object.freeze({
  CURSE_ACTIVATED: 'curse:activated',
  CURSE_EXPIRED: 'curse:expired',
  CURSE_STATE: 'curse:state'
});

function publicEffect(effect) {
  if (!effect) return null;
  return {
    id: effect.id,
    name: effect.name,
    startedAt: effect.startedAt,
    expiresAt: effect.expiresAt,
    duration: effect.duration ?? (effect.expiresAt - effect.startedAt)
  };
}

export function createActivationPayload(effect) {
  return Object.freeze(publicEffect(effect));
}

export function createExpirationPayload(effect, expiredAt) {
  return Object.freeze({
    id: effect.id,
    expiredAt,
    state: 'idle'
  });
}

export function createStatePayload(snapshot) {
  const active = snapshot?.state === 'ACTIVE' && snapshot.activeEffect;
  return Object.freeze({
    state: active ? 'active' : 'idle',
    effect: active ? Object.freeze(publicEffect(snapshot.activeEffect)) : null
  });
}
