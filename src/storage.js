const SETTINGS_KEY = 'vp3_settings';
const ACTIVITY_KEY = 'vp4_activity';
const TIMER_STATE_KEY = 'vp5_timer_state';
const LEGACY_HISTORY_KEY = 'vp3_hist';
const ACTIVITY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_EVENTS = 200;
const ACTIVITY_KINDS = new Set(['visual', 'posture', 'natural']);
const ACTIVITY_SOURCES = new Set(['scheduled', 'manual', 'idle']);

function normalizeActivity(events, now = Date.now()) {
  const cutoff = now - ACTIVITY_RETENTION_MS;
  if (!Array.isArray(events)) return [];
  return events
    .filter(event => event
      && Number.isFinite(event.at)
      && event.at >= cutoff
      && event.at <= now + 60 * 1000
      && ACTIVITY_KINDS.has(event.kind)
      && ACTIVITY_SOURCES.has(event.source))
    .map(event => ({
      at: event.at,
      kind: event.kind,
      source: event.source,
      durationSeconds: Math.max(0, Math.round(Number(event.durationSeconds) || 0)),
      sessionId: Number.isFinite(event.sessionId) ? event.sessionId : event.at
    }))
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_ACTIVITY_EVENTS);
}

function loadActivity(now = Date.now()) {
  try {
    return normalizeActivity(JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]'), now);
  } catch {
    return [];
  }
}

function saveActivity(events, now = Date.now()) {
  const normalized = normalizeActivity(events, now);
  try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(normalized)); }
  catch {}
  return normalized;
}

function appendActivityEvent(events, event, now = Date.now()) {
  return saveActivity([...(Array.isArray(events) ? events : []), event], now);
}

function clearLegacyHistory() {
  try { localStorage.removeItem(LEGACY_HISTORY_KEY); }
  catch {}
}

function loadTimerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TIMER_STATE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveTimerState(state) {
  try { localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(state)); }
  catch {}
}

function clearTimerState() {
  try { localStorage.removeItem(TIMER_STATE_KEY); }
  catch {}
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

window.VisuStorage = {
  loadActivity,
  saveActivity,
  appendActivityEvent,
  clearLegacyHistory,
  loadTimerState,
  saveTimerState,
  clearTimerState,
  loadSettings,
  saveSettings
};
