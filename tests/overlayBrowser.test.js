import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../public/overlay/overlay.js', import.meta.url), 'utf8');

function createClassList() {
  const classes = new Set();
  return {
    add: (...items) => items.forEach((item) => classes.add(item)),
    remove: (...items) => items.forEach((item) => classes.delete(item)),
    contains: (item) => classes.has(item),
    toggle(item, force) {
      if (force === undefined) force = !classes.has(item);
      if (force) classes.add(item); else classes.delete(item);
      return force;
    }
  };
}
function createElement() {
  const attrs = {};
  return {
    textContent: '', innerHTML: '', style: {}, classList: createClassList(),
    setAttribute: (key, value) => { attrs[key] = value; },
    attributes: attrs
  };
}
function harness() {
  const ids = ['streamalchemy-overlay', 'curse-title', 'curse-subtitle', 'curse-status',
    'curse-countdown', 'timer-state', 'timer-progress', 'connection-state'];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement()]));
  const handlers = new Map();
  const socket = { on: vi.fn((event, callback) => handlers.set(event, callback)) };
  const intervals = new Map();
  let nextInterval = 0;
  const window = {
    io: vi.fn(() => socket),
    setInterval: vi.fn((fn) => { const id = ++nextInterval; intervals.set(id, fn); return id; }),
    clearInterval: vi.fn((id) => intervals.delete(id))
  };
  vm.runInNewContext(script, {
    window, document: { getElementById: (id) => elements[id] },
    Date, Number, Boolean, Math
  });
  return {
    elements, handlers, socket, window, intervals,
    fire: (event, payload) => handlers.get(event)?.(payload),
    tick: () => [...intervals.values()].forEach((fn) => fn())
  };
}
const makeEffect = (startedAt = 1_000, expiresAt = startedAt + 30_000) => ({
  id: 'gravity', name: 'Gravity Curse', startedAt, expiresAt, duration: expiresAt - startedAt
});
afterEach(() => vi.restoreAllMocks());

describe('OBS browser overlay', () => {
  it('renders inactive state initially', () => {
    const ui = harness();
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    expect(ui.elements['curse-status'].textContent).toBe('GRAVITY STABLE');
    expect(ui.elements['curse-countdown'].innerHTML).toContain('—');
  });
  it('renders activation and starts gravity animations', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const ui = harness();
    ui.fire('curse:activated', makeEffect());
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-active')).toBe(true);
    expect(ui.elements['curse-title'].textContent).toBe('Gravity Curse');
    expect(ui.elements['curse-countdown'].innerHTML).toContain('30');
    expect(ui.intervals.size).toBe(1);
  });
  it('calculates remaining time from authoritative expiresAt', () => {
    vi.spyOn(Date, 'now').mockReturnValue(11_001);
    const ui = harness();
    ui.fire('curse:activated', makeEffect());
    expect(ui.elements['curse-countdown'].innerHTML).toContain('20');
    expect(ui.elements['timer-progress'].style.transform).toContain('scaleX(0.666');
  });
  it('returns to inactive after expiration', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    const ui = harness();
    ui.fire('curse:activated', makeEffect());
    ui.fire('curse:expired', { id: 'gravity', expiredAt: 31_000, state: 'idle' });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    expect(ui.elements['curse-status'].textContent).toBe('GRAVITY STABLE');
    expect(ui.intervals.size).toBe(0);
  });
  it('restores active state after reconnect using the original expiration timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(16_000);
    const ui = harness();
    ui.fire('disconnect');
    ui.fire('curse:state', { state: 'active', effect: makeEffect() });
    expect(ui.elements['curse-countdown'].innerHTML).toContain('15');
    expect(ui.window.StreamAlchemyOverlay.getState().expiresAt).toBe(31_000);
  });
  it('ignores invalid activation and malformed state payloads', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const ui = harness();
    ui.fire('curse:activated', { id: 'other', expiresAt: 30_000 });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    ui.fire('curse:state', { state: 'active', effect: { id: 'gravity' } });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
  });
  it('reflects Socket.IO disconnection and reconnection', () => {
    const ui = harness();
    ui.fire('connect');
    expect(ui.elements['connection-state'].classList.contains('is-connected')).toBe(true);
    ui.fire('disconnect');
    expect(ui.elements['connection-state'].classList.contains('is-disconnected')).toBe(true);
    ui.fire('connect');
    expect(ui.elements['connection-state'].classList.contains('is-connected')).toBe(true);
  });
  it('does not restart a curse whose authoritative expiration is in the past', () => {
    vi.spyOn(Date, 'now').mockReturnValue(50_000);
    const ui = harness();
    ui.fire('curse:state', { state: 'active', effect: makeEffect() });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    expect(ui.intervals.size).toBe(0);
  });
});
