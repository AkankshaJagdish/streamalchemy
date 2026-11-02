import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const css = await readFile(new URL('../public/overlay/style.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/overlay/index.html', import.meta.url), 'utf8');

const script = await readFile(new URL('../public/overlay/overlay.js', import.meta.url), 'utf8');

function makeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle(name, force) {
      if (force === undefined) force = !values.has(name);
      if (force) values.add(name); else values.delete(name);
      return force;
    }
  };
}
function makeElement() {
  return {
    textContent: '', style: {}, children: [], attributes: {},
    classList: makeClassList(),
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(name, callback) { this.listeners ??= {}; this.listeners[name] = callback; },
    remove() { this.removed = true; },
    pause() { this.paused = true; },
    play() { this.playCalls = (this.playCalls || 0) + 1; return this.playResult ?? Promise.resolve(); },
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); }
  };
}
function createHarness() {
  const ids = ['streamalchemy-overlay', 'curse-title', 'curse-subtitle', 'curse-status',
    'curse-countdown', 'timer-state', 'timer-progress', 'connection-state', 'rickroll-video-layer', 'rickroll-video-fallback'];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement()]));
  const handlers = new Map();
  const socket = { on: vi.fn((name, callback) => handlers.set(name, callback)) };
  const intervals = new Map();
  let intervalSequence = 0;
  const window = {
    io: vi.fn(() => socket),
    setInterval: vi.fn((callback) => { const id = ++intervalSequence; intervals.set(id, callback); return id; }),
    clearInterval: vi.fn((id) => intervals.delete(id))
  };
  const document = {
    getElementById: (id) => elements[id],
    createElement: (tag) => Object.assign(makeElement(tag), { tagName: tag, playResult: window.videoPlayResult }),
    createTextNode: (text) => ({ textContent: String(text) }),
    addEventListener: vi.fn(),
    hidden: false,
    videoPlayResult: null
  };
  vm.runInNewContext(script, { window, document, Date, Number, Boolean, Math });
  return {
    elements, handlers, intervals, window,
    fire: (name, payload) => handlers.get(name)?.(payload),
    tick: () => [...intervals.values()].forEach((callback) => callback()),
    setVideoPlayResult: (result) => { window.videoPlayResult = result; }
  };
}
const effect = (start = 1_000, end = start + 30_000) => ({
  id: 'gravity', name: 'Gravity Curse', startedAt: start, expiresAt: end, duration: end - start
});
afterEach(() => vi.restoreAllMocks());

describe('OBS browser overlay', () => {
  it('defines a compact responsive top strip and local video asset host', () => {
    expect(css).toContain('position:absolute;z-index:30;top:clamp');
    expect(css).toContain('width:min(620px,calc(100vw - 28px))');
    expect(css).toContain('@media(max-width:520px)');
    expect(html).toContain('id="rickroll-video-layer"');
  });
  it('tries WebSocket first and falls back to polling when WebSocket is unavailable', () => {
    const ui = createHarness();
    expect(ui.window.io).toHaveBeenCalledWith(expect.objectContaining({
      transports: ['websocket', 'polling'],
      tryAllTransports: true
    }));
  });
  it('renders initial inactive state', () => {
    const ui = createHarness();
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    expect(ui.elements['curse-status'].textContent).toBe('GRAVITY STABLE');
    expect(ui.elements['curse-countdown'].children[0].textContent).toBe('—');
  });
  it('renders activation and begins countdown', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const ui = createHarness();
    ui.fire('curse:activated', effect());
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-active')).toBe(true);
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(false);
    expect(ui.elements['curse-title'].textContent).toBe('Gravity Curse');
    expect(ui.elements['curse-countdown'].children[0].textContent).toBe('30');
    expect(ui.intervals.size).toBe(1);
  });
  it('selects each visual act from the original activation timestamp', () => {
    const ui = createHarness();
    let now = 1_500;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    ui.fire('curse:activated', effect());
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(1);
    now = 3_000; ui.tick();
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(2);
    now = 5_000; ui.tick();
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(3);
    now = 9_000; ui.tick();
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(4);
    now = 18_000; ui.tick();
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(5);
  });
  it('joins midway through the video stage at the matching playback offset', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const ui = createHarness();
    ui.fire('curse:state', { state: 'active', effect: effect() });
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(4);
    expect(ui.window.StreamAlchemyOverlay.getVideoState().present).toBe(true);
    expect(ui.elements['curse-countdown'].children[0].textContent).toBe('21');
  });
  it('ends the four-second obstruction exactly at the 8-second boundary after a delayed tick', () => {
    let now = 5_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const ui = createHarness();
    ui.fire('curse:activated', effect());
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(3);
    now = 8_001; ui.tick();
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(4);
  });
  it('restores every visual stage after expiry during a delayed callback', () => {
    let now = 5_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const ui = createHarness();
    ui.fire('curse:activated', effect());
    now = 32_000; ui.tick();
    expect(ui.window.StreamAlchemyOverlay.getState().active).toBe(false);
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(0);
    expect(ui.window.StreamAlchemyOverlay.getVideoState().present).toBe(false);
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-active')).toBe(false);
    expect(ui.intervals.size).toBe(0);
  });
  it('plays the full nine-second stage, then removes the video element', () => {
    let now = 9_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const ui = createHarness();
    ui.fire('curse:activated', effect());
    const video = ui.elements['rickroll-video-layer'].children[0];
    expect(video.tagName).toBe('video');
    expect(video.src).toBe('/overlay/assets/rickroll.mp4');
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(false);
    expect(video.playCalls).toBe(1);
    now = 17_000; ui.tick();
    expect(video.paused).toBe(true);
    expect(video.removed).toBe(true);
    expect(ui.window.StreamAlchemyOverlay.getVideoState().present).toBe(false);
  });
  it('does not replay the video when connecting after its stage has ended', () => {
    vi.spyOn(Date, 'now').mockReturnValue(18_000);
    const ui = createHarness();
    ui.fire('curse:state', { state: 'active', effect: effect() });
    expect(ui.window.StreamAlchemyOverlay.getState().stage).toBe(5);
    expect(ui.window.StreamAlchemyOverlay.getVideoState().present).toBe(false);
  });
  it('shows fallback when video playback is rejected without stopping the curse', async () => {
    let now = 9_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const ui = createHarness();
    ui.setVideoPlayResult(Promise.reject(new Error('autoplay blocked')));
    ui.fire('curse:activated', effect());
    await Promise.resolve(); await Promise.resolve();
    expect(ui.window.StreamAlchemyOverlay.getVideoState().failed).toBe(true);
    expect(ui.elements['rickroll-video-layer'].classList.contains('is-fallback')).toBe(true);
    now = 32_000; ui.tick();
    expect(ui.window.StreamAlchemyOverlay.getState().active).toBe(false);
  });
  it('keeps the 30-second engine expiry unchanged', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const ui = createHarness();
    ui.fire('curse:activated', effect());
    expect(ui.window.StreamAlchemyOverlay.getState().expiresAt).toBe(31_000);
    expect(ui.elements['curse-countdown'].children[0].textContent).toBe('30');
  });
  it('calculates remaining time from the original expiresAt timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(11_001);
    const ui = createHarness();
    ui.fire('curse:activated', effect());
    expect(ui.elements['curse-countdown'].children[0].textContent).toBe('20');
    expect(ui.elements['timer-progress'].style.transform).toContain('scaleX(0.666');
  });
  it('returns to idle on expiration', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    const ui = createHarness();
    ui.fire('curse:activated', effect());
    ui.fire('curse:expired', { id: 'gravity', expiredAt: 31_000, state: 'idle' });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-active')).toBe(false);
    expect(ui.elements['curse-status'].textContent).toBe('GRAVITY STABLE');
    expect(ui.intervals.size).toBe(0);
  });
  it('restores active curse after reconnect without resetting its expiry', () => {
    vi.spyOn(Date, 'now').mockReturnValue(16_000);
    const ui = createHarness();
    ui.fire('disconnect');
    ui.fire('curse:state', { state: 'active', effect: effect() });
    expect(ui.elements['curse-countdown'].children[0].textContent).toBe('15');
    expect(ui.window.StreamAlchemyOverlay.getState().expiresAt).toBe(31_000);
  });
  it('ignores invalid activation and malformed active state', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const ui = createHarness();
    ui.fire('curse:activated', { id: 'unknown', expiresAt: 30_000 });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    ui.fire('curse:state', { state: 'active', effect: { id: 'gravity' } });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
  });
  it('reflects disconnection and reconnection state', () => {
    const ui = createHarness();
    ui.fire('connect');
    expect(ui.elements['connection-state'].classList.contains('is-connected')).toBe(true);
    ui.fire('disconnect');
    expect(ui.elements['connection-state'].classList.contains('is-disconnected')).toBe(true);
    ui.fire('connect');
    expect(ui.elements['connection-state'].classList.contains('is-connected')).toBe(true);
  });
  it('does not restore a curse whose expiresAt is already past', () => {
    vi.spyOn(Date, 'now').mockReturnValue(50_000);
    const ui = createHarness();
    ui.fire('curse:state', { state: 'active', effect: effect() });
    expect(ui.elements['streamalchemy-overlay'].classList.contains('is-idle')).toBe(true);
    expect(ui.intervals.size).toBe(0);
  });
});
