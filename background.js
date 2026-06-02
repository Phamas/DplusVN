// background.js — service worker

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyXTkJY7DjflLRE1e1coouwyW5eeKr9mCPnvOAdL9NMUvnt-gehD0IoglrDlN946UlS9w/exec';

// ── GAS batch translation (pre-translation of VTT cues) ───────────────────────
// Allow 2 concurrent GAS requests so multiple VTT chunks translate in parallel.
const MAX_CONCURRENT = 2;
let active = 0;
const queue = [];

function processQueue() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const { texts, resolve, reject } = queue.shift();
    active++;
    translateGAS(texts)
      .then(resolve)
      .catch(reject)
      .finally(() => { active--; processQueue(); });
  }
}

async function translateGAS(texts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ texts }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'GAS error');
    if (Array.isArray(data.translated)) return data.translated;
    throw new Error('Unexpected GAS response format');
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Fast single-cue translation (on-demand cache miss) ────────────────────────
// In-flight dedup: if the same text is requested twice before the first
// resolves, reuse the same Promise instead of firing two API calls.
const inFlight = new Map();

async function translateFast(text) {
  if (inFlight.has(text)) return inFlight.get(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
  const promise = fetch(url)
    .then(r => r.json())
    .then(data => data[0].map(item => item[0]).join(''))
    .finally(() => inFlight.delete(text));
  inFlight.set(text, promise);
  return promise;
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'TRANSLATE_FAST') {
    translateFast(msg.text)
      .then(translated => reply({ ok: true, translated }))
      .catch(() => reply({ ok: false }));
    return true;
  }

  if (msg.type === 'TRANSLATE') {
    const { texts } = msg;
    if (!Array.isArray(texts) || texts.length === 0) {
      reply({ ok: false, translated: [] });
      return true;
    }
    new Promise((resolve, reject) => queue.push({ texts, resolve, reject }))
      .then(translated => reply({ ok: true, translated }))
      .catch(() => reply({ ok: false, translated: [] }));
    processQueue();
    return true;
  }

  return false;
});
