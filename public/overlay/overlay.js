(() => {
  const root = document.getElementById('streamalchemy-overlay');
  const title = document.getElementById('curse-title');
  const subtitle = document.getElementById('curse-subtitle');
  const status = document.getElementById('curse-status');
  const countdown = document.getElementById('curse-countdown');
  const timerState = document.getElementById('timer-state');
  const progress = document.getElementById('timer-progress');
  const connection = document.getElementById('connection-state');
  if (!root || !window.io) return;

  let intervalId = null;
  let activeEffect = null;
  let connected = false;
  const STAGES = [0, 5000, 13000, 17000, 26000, 30000];
  const STAGE_NAMES = ['stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5'];
  let activeStage = 0;
  function clearStages() { root.classList.remove(...STAGE_NAMES); activeStage = 0; }
  function syncStage(now = Date.now()) {
    if (!activeEffect) { clearStages(); return 0; }
    const elapsed = Math.max(0, now - activeEffect.startedAt);
    const stage = elapsed < STAGES[1] ? 1 : elapsed < STAGES[2] ? 2 : elapsed < STAGES[3] ? 3 : elapsed < STAGES[4] ? 4 : elapsed < STAGES[5] ? 5 : 0;
    if (stage !== activeStage) {
      clearStages();
      if (stage) root.classList.add(STAGE_NAMES[stage - 1]);
      activeStage = stage;
    }
    return stage;
  }

  function setConnection(isConnected) {
    connected = isConnected;
    connection.classList.toggle('is-connected', isConnected);
    connection.classList.toggle('is-disconnected', !isConnected);
    connection.replaceChildren(document.createElement('i'));
    connection.append(document.createTextNode(isConnected ? ' ENGINE CONNECTED' : ' RECONNECTING TO ENGINE'));
  }
  function stopCountdown() {
    if (intervalId !== null) window.clearInterval(intervalId);
    intervalId = null;
    activeEffect = null;
    progress.style.transform = 'scaleX(0)';
  }
  function renderIdle(message = 'The world is in balance. For now.') {
    stopCountdown();
    root.classList.remove('is-active');
    root.classList.add('is-idle');
    clearStages();
    title.textContent = 'Gravity Curse';
    subtitle.textContent = message;
    status.textContent = 'GRAVITY STABLE';
    timerState.textContent = 'READY';
    timerState.style.color = '#86efac';
    countdown.replaceChildren(document.createTextNode('—'), Object.assign(document.createElement('span'), { textContent: ' SEC' }));
    countdown.setAttribute('aria-label', 'No active curse');
  }
  function isValidEffect(effect) {
    return Boolean(effect && effect.id === 'gravity' && typeof effect.name === 'string'
      && Number.isFinite(effect.startedAt) && Number.isFinite(effect.expiresAt)
      && effect.expiresAt > effect.startedAt && Number.isFinite(effect.duration) && effect.duration > 0);
  }
  function renderCountdown() {
    if (!activeEffect) return;
    const now = Date.now();
    const remainingMs = Math.max(0, activeEffect.expiresAt - now);
    const seconds = Math.ceil(remainingMs / 1000);
    countdown.replaceChildren(document.createTextNode(String(seconds)), Object.assign(document.createElement('span'), { textContent: ' SEC' }));
    countdown.setAttribute('aria-label', `${seconds} seconds remaining`);
    const total = activeEffect.duration || (activeEffect.expiresAt - activeEffect.startedAt);
    const elapsed = Math.max(0, Math.min(total, now - activeEffect.startedAt));
    progress.style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - elapsed / total))})`;
    syncStage(now);
    if (remainingMs <= 0) renderIdle('The gravity field has faded.');
  }
  function renderActive(effect) {
    if (!isValidEffect(effect)) { renderIdle('Waiting for a valid curse signal.'); return false; }
    if (effect.expiresAt <= Date.now()) { renderIdle('The gravity field has faded.'); return false; }
    stopCountdown();
    activeEffect = {
      id: effect.id, name: effect.name, startedAt: effect.startedAt,
      expiresAt: effect.expiresAt, duration: effect.duration
    };
    root.classList.remove('is-idle');
    root.classList.add('is-active');
    title.textContent = effect.name;
    subtitle.textContent = 'Gravity has reversed. Hold on to something.';
    status.textContent = 'GRAVITY FIELD ACTIVE';
    timerState.textContent = 'IN PROGRESS';
    timerState.style.color = '#d8b4fe';
    renderCountdown();
    if (activeEffect) intervalId = window.setInterval(renderCountdown, 100);
    return true;
  }
  const socket = window.io({
    reconnection: true, reconnectionAttempts: Infinity,
    reconnectionDelay: 500, reconnectionDelayMax: 5000,
    timeout: 10000, transports: ['websocket', 'polling'], tryAllTransports: true
  });
  socket.on('connect', () => setConnection(true));
  socket.on('disconnect', () => setConnection(false));
  socket.on('connect_error', () => setConnection(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderCountdown(); });
  socket.on('curse:activated', renderActive);
  socket.on('curse:expired', (payload) => {
    if (!payload || payload.id !== 'gravity' || payload.state !== 'idle' || !Number.isFinite(payload.expiredAt)) return;
    renderIdle('The gravity field has faded.');
  });
  socket.on('curse:state', (snapshot) => {
    if (!snapshot || !['active', 'idle'].includes(snapshot.state)) return;
    if (snapshot.state === 'active') renderActive(snapshot.effect);
    else if (snapshot.effect === null) renderIdle();
  });
  renderIdle();
  setConnection(false);
  window.StreamAlchemyOverlay = Object.freeze({
    renderActive, renderIdle, renderCountdown, isValidEffect,
    getState: () => ({ active: Boolean(activeEffect), expiresAt: activeEffect?.expiresAt ?? null, connected, stage: syncStage() })
  });
})();
