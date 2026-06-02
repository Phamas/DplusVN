// content.js — runs in ISOLATED world

const MAX_CUES = 3000;

// ─── State ────────────────────────────────────────────────────────────────────
let overlay = null;
let currentCues = [];
let seenUrlKeys = new Set();
let videoEl = null;
let lastCueText = null;
let lastVideoId = '';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getVideoId() {
  const match = location.pathname.match(/\/(?:video\/watch|watch)\/([^/?#]+)/);
  return match ? match[1] : location.pathname;
}

// ─── Reset on new VIDEO CONTENT only (not on seek) ───────────────────────────
function resetForNewVideo() {
  console.log('[D+VT] New video detected, resetting cues + seenUrls (keeping videoEl).');
  currentCues = [];
  seenUrlKeys = new Set();
  // Do NOT null out videoEl — we still need it for rendering
  lastCueText = null;
  if (overlay) overlay.textContent = '';
  window.dispatchEvent(new CustomEvent('D_PLUS_RESET'));
}

function watchForNavigation() {
  lastVideoId = getVideoId();
  setInterval(() => {
    const videoId = getVideoId();
    if (videoId !== lastVideoId) {
      console.log(`[D+VT] Video ID changed: ${lastVideoId} → ${videoId}`);
      lastVideoId = videoId;
      resetForNewVideo();
    }
  }, 1500);
}

// ─── Overlay ──────────────────────────────────────────────────────────────────
function createOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'dvt-overlay';
  overlay.style.cssText = `
    position: fixed !important;
    bottom: 18% !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    width: 85% !important;
    max-width: 960px !important;
    text-align: center !important;
    color: #00FFFF !important;
    font-size: 26px !important;
    line-height: 1.4 !important;
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif !important;
    font-weight: 700 !important;
    text-shadow:
      -1px -1px 0 #000,
       1px -1px 0 #000,
      -1px  1px 0 #000,
       1px  1px 0 #000,
       0    2px 8px rgba(0,0,0,1) !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    background: transparent !important;
    word-break: break-word !important;
  `;

  function attach() {
    if (document.body) {
      document.body.appendChild(overlay);
      console.log('[D+VT] Overlay attached.');
      overlay.textContent = '✅ D+VT active';
      setTimeout(() => { if (overlay) overlay.textContent = ''; }, 2000);
    } else {
      requestAnimationFrame(attach);
    }
  }
  attach();
}

// ─── VTT Parser ───────────────────────────────────────────────────────────────
function tsToSeconds(ts) {
  const [hms, ms] = ts.replace(',', '.').split('.');
  const parts = hms.split(':');
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 +
    parseFloat(parts[2]) + parseFloat('0.' + (ms || '0'));
}

function parseMpegTsOffset(vttText) {
  const header = vttText.slice(0, 500);
  const match = header.match(
    /X-TIMESTAMP-MAP=MPEGTS:(\d+),LOCAL:(\d{2}:\d{2}:\d{2}[.,]\d+)/i
  );
  if (!match) return 0;
  const mpegts = parseInt(match[1], 10);
  const local  = tsToSeconds(match[2]);
  const offset = (mpegts / 90000) - local;
  if (Math.abs(offset) > 86400) return 0;
  console.log(`[D+VT] MPEGTS offset: ${offset.toFixed(3)}s`);
  return offset;
}

function stripVttTags(text) {
  return text.replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}

function parseVtt(vttText) {
  if (!vttText || typeof vttText !== 'string') return [];
  const offset = parseMpegTsOffset(vttText);
  const cues = [];
  const lines = vttText.split(/\r?\n/);
  let currentCue = null;

  for (const line of lines) {
    const timeMatch = line.match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/
    );
    if (timeMatch) {
      const start = Math.max(0, tsToSeconds(timeMatch[1]) - offset);
      const end   = Math.max(0, tsToSeconds(timeMatch[2]) - offset);
      currentCue = { start, end, text: '' };
      cues.push(currentCue);
      continue;
    }
    if (currentCue) {
      const stripped = stripVttTags(line.trim());
      if (stripped && !stripped.startsWith('NOTE') && stripped !== 'WEBVTT') {
        currentCue.text += (currentCue.text ? ' ' : '') + stripped;
      }
    }
  }
  return cues.filter(c => c.text.length > 0);
}

// ─── Cue Merge ────────────────────────────────────────────────────────────────
function mergeCues(newCues) {
  const existingStarts = new Set(currentCues.map(c => c.start.toFixed(2)));
  const fresh = newCues.filter(c => !existingStarts.has(c.start.toFixed(2)));
  currentCues = [...currentCues, ...fresh].sort((a, b) => a.start - b.start);
  if (currentCues.length > MAX_CUES) {
    currentCues = currentCues.slice(currentCues.length - MAX_CUES);
  }
}

// ─── Translation ──────────────────────────────────────────────────────────────
function translateCues(cues) {
  const texts = cues.map(c => c.text);
  console.log(`[D+VT] Sending ${texts.length} cues for translation...`);

  chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', texts }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[D+VT] Message error:', chrome.runtime.lastError.message);
      mergeCues(cues);
      return;
    }

    if (response && response.success && Array.isArray(response.translated)) {
      console.log(`[D+VT] ✅ Got ${response.translated.length} translations for ${cues.length} cues`);
      cues.forEach((cue, i) => {
        const t = (response.translated[i] || '').trim();
        if (t) cue.text = t;
      });
    } else {
      console.warn('[D+VT] Translation response unexpected:', JSON.stringify(response));
    }

    mergeCues(cues);
    if (currentCues.length > 0) {
      console.log(`[D+VT] Total cues: ${currentCues.length}. Range: ${currentCues[0].start.toFixed(1)}s – ${currentCues[currentCues.length-1].end.toFixed(1)}s`);
    }
  });
}

// ─── Subtitle Event Listener ──────────────────────────────────────────────────
window.addEventListener('D_PLUS_SUBTITLE', (event) => {
  const { url, text } = event.detail;
  const urlKey = url.split('?')[0];
  if (seenUrlKeys.has(urlKey)) return;
  seenUrlKeys.add(urlKey);

  const cues = parseVtt(text);
  if (cues.length === 0) {
    console.warn('[D+VT] Parsed 0 cues from:', urlKey);
    return;
  }

  console.log(`[D+VT] Parsed ${cues.length} cues from chunk. Range: ${cues[0].start.toFixed(1)}s – ${cues[cues.length-1].end.toFixed(1)}s`);
  translateCues(cues);
});

// ─── Video Finder ─────────────────────────────────────────────────────────────
function findBestVideo() {
  const candidates = Array.from(document.querySelectorAll('video'));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, v) =>
    (v.videoWidth * v.videoHeight) > (best.videoWidth * best.videoHeight) ? v : best,
    candidates[0]
  );
}

function startVideoWatch() {
  setInterval(() => {
    const found = findBestVideo();
    if (found && found !== videoEl) {
      videoEl = found;
      console.log(`[D+VT] Video element found: ${videoEl.videoWidth}x${videoEl.videoHeight}`);
    }
  }, 1000);
}

// ─── Binary Search ────────────────────────────────────────────────────────────
function findActiveCue(currentTime) {
  let lo = 0, hi = currentCues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = currentCues[mid];
    if (currentTime < cue.start) hi = mid - 1;
    else if (currentTime > cue.end) lo = mid + 1;
    else return cue;
  }
  return null;
}

// ─── Render Loop ──────────────────────────────────────────────────────────────
function renderLoop() {
  if (overlay && videoEl && document.contains(videoEl)) {
    const cue = findActiveCue(videoEl.currentTime);
    const text = cue ? cue.text : '';
    if (text !== lastCueText) {
      overlay.textContent = text;
      lastCueText = text;
    }
  }
  requestAnimationFrame(renderLoop);
}

// ─── Suppress native subtitles ────────────────────────────────────────────────
function suppressNativeSubtitles() {
  const style = document.createElement('style');
  style.textContent = `
    [data-testid="text-track"],
    [data-testid="subtitles-container"],
    .subtitle-text-container,
    .text-track-container,
    .player-timed-text {
      display: none !important;
      opacity: 0 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  function disableTracks() {
    document.querySelectorAll('video track').forEach(t => { t.mode = 'disabled'; });
    const vid = findBestVideo();
    if (vid && vid.textTracks) {
      for (let i = 0; i < vid.textTracks.length; i++) {
        vid.textTracks[i].mode = 'hidden';
      }
    }
  }
  disableTracks();
  setInterval(disableTracks, 2000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
createOverlay();
suppressNativeSubtitles();
startVideoWatch();
watchForNavigation();
renderLoop();