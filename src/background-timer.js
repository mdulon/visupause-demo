let pulseId = null;

function stopPulse() {
  if (pulseId !== null) {
    self.clearInterval(pulseId);
    pulseId = null;
  }
}

function sendTick() {
  self.postMessage({ type: 'VISUPAUSE_TIMER_TICK', now: Date.now() });
}

self.addEventListener('message', event => {
  if (event.data?.type === 'STOP') {
    stopPulse();
    return;
  }
  if (event.data?.type !== 'START') return;
  const requested = Number(event.data.intervalMs);
  const intervalMs = Number.isFinite(requested)
    ? Math.min(5000, Math.max(1000, Math.round(requested)))
    : 1000;
  stopPulse();
  sendTick();
  pulseId = self.setInterval(sendTick, intervalMs);
});
