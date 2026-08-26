function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function reminderProgress(remainingSeconds, intervalSeconds) {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return 0;
  const remaining = Number.isFinite(remainingSeconds) ? remainingSeconds : intervalSeconds;
  return clamp((intervalSeconds - remaining) / intervalSeconds);
}

function rhythmState({ running = false, inBreak = false, breakPending = false, idlePaused = false } = {}) {
  if (idlePaused) return 'away';
  if (inBreak) return 'break';
  if (breakPending) return 'pending';
  if (running) return 'running';
  return 'ready';
}

window.VisuRhythm = { reminderProgress, rhythmState };
