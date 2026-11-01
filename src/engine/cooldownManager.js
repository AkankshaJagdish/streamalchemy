/**
 * A single-effect guard. It deliberately does not implement stacking,
 * queuing, or per-viewer cooldowns: while an effect is active, another
 * activation is rejected as already-active.
 */
export function createCooldownManager({ now = Date.now } = {}) {
  let expiresAt = null;

  return Object.freeze({
    isActive() {
      return expiresAt !== null && now() < expiresAt;
    },
    getExpiresAt() {
      return expiresAt;
    },
    start(untilTimestamp) {
      if (!Number.isFinite(untilTimestamp) || untilTimestamp <= now()) {
        throw new RangeError('Cooldown expiry must be a future timestamp');
      }
      if (this.isActive()) return false;
      expiresAt = untilTimestamp;
      return true;
    },
    clear() {
      expiresAt = null;
    }
  });
}
