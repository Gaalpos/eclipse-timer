const STORAGE_KEY = 'countdown-steps-data';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.target) document.getElementById('target-datetime').value = data.target;
      if (data.ttsLang) document.getElementById('tts-lang').value = data.ttsLang;
      return data;
    }
  } catch (_) {}
  return { target: null, steps: [], ttsLang: 'es', ttsVoiceId: null };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

let state = loadState();
if (!state.ttsLang) state.ttsLang = 'es';
const ttsLangEl = document.getElementById('tts-lang');
if (ttsLangEl && !state.ttsLang) ttsLangEl.value = 'es';
let steps = Array.isArray(state.steps)
  ? state.steps.map((s, i) => {
      const id = s.id || 'legacy-' + i + '-' + (s.minutesBefore ?? s.offsetSeconds ?? 0);
      const offsetSeconds =
        typeof s.offsetSeconds === 'number'
          ? s.offsetSeconds
          : typeof s.minutesBefore === 'number'
            ? s.minutesBefore * 60
            : 0;
      return { id, label: s.label, offsetSeconds };
    })
  : [];
const announcedStepIds = new Set();

function getStepOffsetSeconds(step) {
  if (typeof step.offsetSeconds === 'number') return step.offsetSeconds;
  if (typeof step.minutesBefore === 'number') return step.minutesBefore * 60;
  return 0;
}

function getStepOffsetMs(step) {
  return getStepOffsetSeconds(step) * 1000;
}

function formatStepOffsetForSpeech(step) {
  const totalSeconds = getStepOffsetSeconds(step);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return minutes + ' minutes';
  if (minutes === 0) return seconds + ' seconds';
  return minutes + ' minutes ' + seconds + ' seconds';
}

function formatStepOffsetShort(step) {
  const totalSeconds = getStepOffsetSeconds(step);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return minutes + 'm';
  if (minutes === 0) return seconds + 's';
  return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
}

// --- Text-to-speech: load voices once and pick natural-sounding voice ---
let cachedVoices = [];
function loadVoices() {
  const list = window.speechSynthesis?.getVoices() ?? [];
  cachedVoices = Array.from(list);
  if (cachedVoices.length === 0) return;
  if (typeof onVoicesReady === 'function') onVoicesReady();
}
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices(); // Chrome sometimes only populates after first call
}

function getLangTag() {
  const lang = state.ttsLang || 'es';
  return lang === 'es' ? 'es-ES' : 'en-US';
}

/** Prefer default for language, then local (often higher quality), then any match. */
function selectBestVoice(langTag, preferredVoiceId) {
  const langPrefix = langTag.split('-')[0];
  const forLang = cachedVoices.filter(v => v.lang.startsWith(langPrefix));
  if (preferredVoiceId && forLang.length) {
    const preferred = forLang.find(v => (v.voiceURI || v.name) === preferredVoiceId);
    if (preferred) return preferred;
  }
  const defaultForLang = forLang.find(v => v.default);
  if (defaultForLang) return defaultForLang;
  const localForLang = forLang.filter(v => v.localService);
  if (localForLang.length) return localForLang[0];
  if (forLang.length) return forLang[0];
  const defaultAny = cachedVoices.find(v => v.default);
  return defaultAny || cachedVoices[0] || null;
}

function speak(text) {
  if (!text || !window.speechSynthesis) return;
  speechSynthesis.cancel(); // avoid overlapping announcements
  const langTag = getLangTag();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = langTag;
  u.rate = 0.92;  // slightly slower often sounds more natural
  u.pitch = 1;
  u.volume = 1;
  const voice = selectBestVoice(langTag, state.ttsVoiceId);
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

function checkAndSpeakSteps() {
  const targetMs = getTargetMs();
  if (!targetMs) return;
  const now = Date.now();
  for (const step of steps) {
    const stepTimeMs = targetMs - getStepOffsetMs(step);
    if (now >= stepTimeMs && !announcedStepIds.has(step.id)) {
      announcedStepIds.add(step.id);
      speak(step.label || 'Step at ' + formatStepOffsetForSpeech(step) + ' before');
    }
  }
}

function formatTargetLabel(iso) {
  if (!iso) return 'No target set';
  const d = new Date(iso);
  return 'Target: ' + d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderTargetLabel() {
  document.getElementById('target-label').textContent = formatTargetLabel(state.target);
}

function getTargetMs() {
  if (!state.target) return null;
  return new Date(state.target).getTime();
}

function updateCountdown() {
  const el = document.getElementById('countdown');
  const targetMs = getTargetMs();

  if (!targetMs) {
    el.textContent = 'Set a target time to start';
    el.className = 'countdown-display future';
    return;
  }

  const now = Date.now();
  const diff = targetMs - now;

  if (diff <= 0) {
    el.textContent = 'Event time reached';
    el.className = 'countdown-display done';
    return;
  }

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(hours + 'h');
  parts.push(String(minutes).padStart(2, '0') + 'm');
  parts.push(String(seconds).padStart(2, '0') + 's');
  el.textContent = parts.join(' ');
  el.className = 'countdown-display future';
}

function getStepStatus(step, sortedSteps) {
  const targetMs = getTargetMs();
  if (!targetMs) return 'future';
  const stepTimeMs = targetMs - getStepOffsetMs(step);
  const now = Date.now();
  if (now > stepTimeMs) return 'past';
  const nextUpcoming = sortedSteps.find(s => targetMs - getStepOffsetMs(s) > now);
  const isNext = nextUpcoming && nextUpcoming.id === step.id;
  return isNext ? 'current' : 'future';
}

function formatStepTime(step) {
  const targetMs = getTargetMs();
  if (!targetMs) return formatStepOffsetShort(step) + ' before';
  const stepTime = new Date(targetMs - getStepOffsetMs(step));
  return stepTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' (' + formatStepOffsetShort(step) + ' before)';
}

function renderSteps() {
  const list = document.getElementById('steps-list');
  const sorted = [...steps].sort((a, b) => getStepOffsetSeconds(b) - getStepOffsetSeconds(a));

  if (sorted.length === 0) {
    list.innerHTML = '<li class="empty-state">No steps yet. Add steps with their "minutes before target".</li>';
    return;
  }

  list.innerHTML = sorted.map((step, index) => {
    const status = getStepStatus(step, sorted);
    const id = step.id;
    return `
      <li class="step-item ${status}" data-id="${escapeHtml(id)}">
        <span class="step-time">${formatStepTime(step)}</span>
        <span class="step-label">${escapeHtml(step.label || 'Step ' + (index + 1))}</span>
        <button type="button" class="btn-danger" data-id="${escapeHtml(id)}" aria-label="Remove step">Remove</button>
      </li>
    `;
  }).join('');

  list.querySelectorAll('.btn-danger').forEach(btn => {
    btn.addEventListener('click', () => {
      const stepId = btn.dataset.id;
      steps = steps.filter(s => s.id !== stepId);
      saveState({ ...state, steps });
      renderSteps();
    });
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function populateVoiceList() {
  const sel = document.getElementById('tts-voice');
  if (!sel) return;
  const langPrefix = (state.ttsLang || 'es').split('-')[0];
  const forLang = cachedVoices.filter(v => v.lang.startsWith(langPrefix));
  const currentId = state.ttsVoiceId;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Default (best for language)';
  sel.appendChild(opt0);
  for (const v of forLang) {
    const id = v.voiceURI || v.name;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = v.name || id;
    if (id === currentId) opt.selected = true;
    sel.appendChild(opt);
  }
  if (!sel.value && currentId) state.ttsVoiceId = null;
}

function onVoicesReady() {
  populateVoiceList();
}

ttsLangEl.addEventListener('change', () => {
  state.ttsLang = ttsLangEl.value;
  state.ttsVoiceId = null;
  saveState({ ...state, steps });
  populateVoiceList();
});

const ttsVoiceEl = document.getElementById('tts-voice');
if (ttsVoiceEl) {
  ttsVoiceEl.addEventListener('change', () => {
    state.ttsVoiceId = ttsVoiceEl.value || null;
    saveState({ ...state, steps });
  });
}

document.getElementById('set-target').addEventListener('click', () => {
  const input = document.getElementById('target-datetime');
  const value = input.value;
  if (!value) return;
  state.target = value;
  announcedStepIds.clear();
  saveState({ ...state, steps });
  renderTargetLabel();
  updateCountdown();
  renderSteps();
});

document.getElementById('add-step').addEventListener('click', () => {
  const minutesEl = document.getElementById('step-minutes');
  const secondsEl = document.getElementById('step-seconds');
  const labelEl = document.getElementById('step-label');
  const minutes = parseInt(minutesEl.value, 10);
  const seconds = secondsEl ? parseInt(secondsEl.value, 10) : 0;

  const safeMinutes = Number.isNaN(minutes) ? 0 : minutes;
  const safeSeconds = Number.isNaN(seconds) ? 0 : seconds;
  if (safeMinutes < 0 || safeSeconds < 0 || safeSeconds > 59) return;
  const totalSeconds = safeMinutes * 60 + safeSeconds;
  if (totalSeconds <= 0) return;

  const tempStep = { offsetSeconds: totalSeconds };
  const defaultLabel = 'Step at ' + formatStepOffsetShort(tempStep) + ' before';
  const label = (labelEl.value || '').trim() || defaultLabel;

  steps.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    offsetSeconds: totalSeconds,
    label
  });
  steps.sort((a, b) => getStepOffsetSeconds(b) - getStepOffsetSeconds(a));
  saveState({ ...state, steps });
  minutesEl.value = '';
  if (secondsEl) secondsEl.value = '';
  labelEl.value = '';
  renderSteps();
});

document.getElementById('step-label').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-step').click();
});

renderTargetLabel();
updateCountdown();
renderSteps();
populateVoiceList();
setInterval(() => {
  updateCountdown();
  checkAndSpeakSteps();
}, 1000);
setInterval(renderSteps, 2000);
