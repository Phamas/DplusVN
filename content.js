// content.js — ISOLATED world

// ── Translation cache: stripped cue text → Vietnamese ─────────────────────────
const cache = new Map();
const pending = new Set();
const MAX_CACHE = 3000;

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

// ── Settings ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  color: '#00FFFF', fontSize: 26, fontFamily: '"Segoe UI",Arial,sans-serif',
  fontWeight: '700', bgColor: '#000000', bgOpacity: 0, bgPadding: 0,
  shadow: true, bottom: 12, width: 88, showOriginal: true,
};
let settings = { ...DEFAULTS };

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

function applySettings(s) {
  settings = { ...DEFAULTS, ...s };
  if (!overlay) return;
  const bg = settings.bgOpacity > 0
    ? `rgba(${hexToRgb(settings.bgColor)},${settings.bgOpacity/100})`
    : 'transparent';
  const shadow = settings.shadow
    ? '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000'
    : 'none';
  overlay.style.cssText = `
    position:fixed !important;
    bottom:${settings.bottom}% !important;
    left:50% !important;
    transform:translateX(-50%) !important;
    width:${settings.width}% !important;
    max-width:1200px !important;
    text-align:center !important;
    color:${settings.color} !important;
    font-size:${settings.fontSize}px !important;
    font-weight:${settings.fontWeight} !important;
    font-family:${settings.fontFamily} !important;
    line-height:1.45 !important;
    text-shadow:${shadow} !important;
    background:${bg} !important;
    padding:${settings.bgPadding}px ${settings.bgPadding+4}px !important;
    border-radius:${settings.bgPadding > 0 ? '4px' : '0'} !important;
    pointer-events:none !important;
    z-index:2147483647 !important;
    word-break:break-word !important;
  `;
}

function loadSettings() {
  chrome.storage.sync.get('subtitleSettings', ({ subtitleSettings }) => {
    applySettings(subtitleSettings || {});
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.subtitleSettings) applySettings(changes.subtitleSettings.newValue || {});
});

// ── Overlay ───────────────────────────────────────────────────────────────────
let overlay = null;

function createOverlay() {
  overlay = document.createElement('div');
  overlay.id = 'dpvt-overlay';
  function attach() {
    if (document.body) {
      document.body.appendChild(overlay);
      loadSettings();
      console.log('[DPVT] Overlay attached.');
      overlay.textContent = '❤️ D+VT for my wife';
      setTimeout(() => { if (overlay.textContent === '❤️ D+VT for my wife') overlay.textContent = ''; }, 2000);
    } else requestAnimationFrame(attach);
  }
  attach();
}

// ── Text helpers ──────────────────────────────────────────────────────────────
function stripTags(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Translation ───────────────────────────────────────────────────────────────
function translateAndCache(texts, onDone) {
  const needed = texts.filter(t => t && !cache.has(t) && !pending.has(t));
  if (!needed.length) { onDone?.(); return; }
  needed.forEach(t => pending.add(t));
  chrome.runtime.sendMessage({ type: 'TRANSLATE', texts: needed }, resp => {
    needed.forEach(t => pending.delete(t));
    if (resp?.ok) needed.forEach((t, i) => { if (resp.translated[i]) cacheSet(t, resp.translated[i]); });
    onDone?.();
  });
}

function translateFast(text, onDone) {
  if (pending.has(text)) return;
  pending.add(text);
  chrome.runtime.sendMessage({ type: 'TRANSLATE_FAST', text }, resp => {
    pending.delete(text);
    if (resp?.ok && resp.translated) onDone(resp.translated);
  });
}

// ── Shadow root (cached) ──────────────────────────────────────────────────────
let subtitleRoot = null;

function getSubtitleRoot() {
  if (subtitleRoot) return subtitleRoot;
  const host = document.querySelector('timed-text-override-region');
  if (host?.shadowRoot) subtitleRoot = host.shadowRoot;
  return subtitleRoot;
}

// ── Text fragment reader ──────────────────────────────────────────────────────
function getPlayerTextFragments() {
  const root = getSubtitleRoot();
  if (!root) return [];
  const frags = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (t.length > 2 && t.length < 500) frags.push(t);
  }
  return frags;
}

// ── Subtitle detection & display ──────────────────────────────────────────────
let lastShownKey = '';

function showOverlay(text) {
  if (overlay) overlay.textContent = text || '';
}

function checkSubtitle() {
  const frags = getPlayerTextFragments();
  if (!frags.length) { showOverlay(''); lastShownKey = ''; return; }

  // Try each fragment and the fully-joined version as cache keys.
  // VTT parser joins multi-line cues with a space; shadow DOM may split them.
  const stripped = frags.map(f => stripTags(f));
  const joined   = stripped.join(' ');
  const keys     = stripped.length > 1 ? [...stripped, joined] : stripped;

  for (const key of keys) {
    if (key === lastShownKey) return;
    if (cache.has(key)) {
      lastShownKey = key;
      showOverlay(cache.get(key));
      return;
    }
  }

  // Cache miss — on-demand translation
  const key = joined;
  if (key === lastShownKey) return;
  lastShownKey = key;

  if (settings.showOriginal) showOverlay(frags.join(' '));
  translateFast(key, translated => {
    cacheSet(key, translated);
    if (lastShownKey === key) showOverlay(translated);
  });
}

// ── Player observer (RAF-debounced) ──────────────────────────────────────────
let playerObserver = null;
let rafPending = false;

function scheduleCheck() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; checkSubtitle(); });
}

function attachPlayerObserver() {
  if (playerObserver) return true;
  const root = getSubtitleRoot();
  if (!root) return false;
  playerObserver = new MutationObserver(scheduleCheck);
  playerObserver.observe(root, { childList: true, subtree: true, characterData: true });
  console.log('[DPVT] Observer attached to timed-text-override-region.');
  return true;
}

// Poll until attached, then stop
const attachInterval = setInterval(() => {
  if (attachPlayerObserver()) clearInterval(attachInterval);
}, 1000);

// Move overlay into/out of the fullscreen element so position:fixed stays visible
function handleFullscreenChange() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  const parent = (fs && !fs.contains(overlay)) ? fs : document.body;
  if (overlay && overlay.parentElement !== parent) parent.appendChild(overlay);

  // Also reset shadow root — player may re-render on fullscreen
  subtitleRoot = null;
  if (playerObserver) { playerObserver.disconnect(); playerObserver = null; }
  lastShownKey = '';
  const retry = setInterval(() => {
    if (attachPlayerObserver()) clearInterval(retry);
  }, 300);
}
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

// ── VTT pre-translation ───────────────────────────────────────────────────────
function extractCueTexts(vtt) {
  const texts = new Set();
  const lines = vtt.split(/\r?\n/);
  let inCue = false, buf = '';
  for (const line of lines) {
    if (line.includes('-->')) { inCue = true; buf = ''; }
    else if (inCue && line.trim() === '') {
      const t = stripTags(buf.trim());
      if (t) texts.add(t);
      inCue = false; buf = '';
    } else if (inCue) {
      buf += (buf ? ' ' : '') + line;
    }
  }
  if (inCue && buf.trim()) texts.add(stripTags(buf.trim()));
  return [...texts];
}

const seenVtts = new Set();
window.addEventListener('DPVT_SUBTITLE', ({ detail: { url, text } }) => {
  const key = url.split('?')[0];
  if (seenVtts.has(key)) return;
  seenVtts.add(key);
  const texts = extractCueTexts(text);
  if (!texts.length) return;
  console.log(`[DPVT] Pre-translating ${texts.length} cues from`, key.split('/').pop());
  translateAndCache(texts);
});

// ── Navigation reset ──────────────────────────────────────────────────────────
let lastVideoId = '';
function getVideoId() {
  const m = location.pathname.match(/\/(?:video\/watch|watch)\/([^/?#]+)/);
  return m ? m[1] : '';
}
setInterval(() => {
  const id = getVideoId();
  if (id && id !== lastVideoId) {
    lastVideoId = id;
    seenVtts.clear();
    cache.clear();
    lastShownKey = '';
    subtitleRoot = null;
    showOverlay('');
    if (playerObserver) { playerObserver.disconnect(); playerObserver = null; }
    window.dispatchEvent(new CustomEvent('DPVT_RESET'));
    console.log('[DPVT] Reset for new video:', id);
  }
}, 2000);

// ── Init ──────────────────────────────────────────────────────────────────────
createOverlay();
