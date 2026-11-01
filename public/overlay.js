(() => {
  const status = document.getElementById('curse-status');
  const countdown = document.getElementById('curse-countdown');
  let expiryInterval = null;
  let expiresAt = null;

  function stopCountdown() {
    if (expiryInterval !== null) window.clearInterval(expiryInterval);
    expiryInterval = null;
    expiresAt = null;
    countdown.textContent = '';
  }

  function startCountdown(effect) {
    stopCountdown();
    expiresAt = Number(effect?.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const render = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      countdown.textContent = `${Math.ceil(remaining / 1000)}s remaining`;
      if (remaining <= 0) stopCountdown();
    };
    render();
    expiryInterval = window.setInterval(render, 200);
  }

  const socket = window.io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    timeout: 10000
  });

  socket.on('connect', () => {
    status.textContent = 'Connected';
  });
  socket.on('disconnect', () => {
    status.textContent = 'Reconnecting…';
  });
  socket.on('curse:state', (snapshot) => {
    if (snapshot?.state === 'active' && snapshot.effect) {
      status.textContent = snapshot.effect.name || 'Curse active';
      startCountdown(snapshot.effect);
    } else {
      stopCountdown();
      status.textContent = 'No active curse';
    }
  });
  socket.on('curse:activated', (effect) => {
    status.textContent = effect?.name || 'Curse active';
    startCountdown(effect);
  });
  socket.on('curse:expired', () => {
    stopCountdown();
    status.textContent = 'No active curse';
  });
})();
