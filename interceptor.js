// interceptor.js — runs in MAIN world before Disney+ scripts
// Intercepts subtitle network requests and forwards them to content.js via CustomEvent

console.log("[D+VT] Interceptor loaded.");

// ─── URL Filter ───────────────────────────────────────────────────────────────
const SUBTITLE_PATTERNS = [
  /\.vtt(\?|$)/i,
  /\.ttml(\?|$)/i,
  /subtitles?\//i,
  /captions?\//i,
  /\/sub\//i,
  /bamgrid\.com.*\.vtt/i,
  /dssott\.com.*\.(vtt|ttml)/i,
];

// ─── Dedup cache — reset on each new video ───────────────────────────────────
let dispatchedUrls = new Set();

// Listen for reset signal from content.js (fires on each new video navigation)
window.addEventListener('D_PLUS_RESET', () => {
  dispatchedUrls = new Set();
  console.log('[D+VT] Interceptor cache cleared for new video.');
});

function isSubtitleUrl(url) {
  if (typeof url !== 'string') return false;
  if (url.includes('.m4s')) return false;
  if (url.includes('.m3u8')) return false;
  if (url.includes('.mpd')) return false;
  return SUBTITLE_PATTERNS.some(pattern => pattern.test(url));
}

function dispatch(url, text) {
  const key = url.split('?')[0];
  if (dispatchedUrls.has(key)) return;
  dispatchedUrls.add(key);

  // Keep the cache bounded
  if (dispatchedUrls.size > 200) {
    dispatchedUrls.delete(dispatchedUrls.values().next().value);
  }

  window.dispatchEvent(new CustomEvent('D_PLUS_SUBTITLE', {
    detail: { url, text }
  }));
}

// ─── Intercept fetch ──────────────────────────────────────────────────────────
const _fetch = window.fetch;
window.fetch = async (...args) => {
  const url = args[0] instanceof Request ? args[0].url : String(args[0]);
  const response = await _fetch(...args);

  if (isSubtitleUrl(url)) {
    response.clone().text()
      .then(text => dispatch(url, text))
      .catch(() => {});
  }

  return response;
};

// ─── Intercept XHR ───────────────────────────────────────────────────────────
const _xhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
  const urlStr = String(url);
  if (isSubtitleUrl(urlStr)) {
    this.addEventListener('load', () => {
      dispatch(urlStr, this.responseText);
    });
  }
  return _xhrOpen.apply(this, arguments);
};