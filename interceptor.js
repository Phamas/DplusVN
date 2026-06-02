// interceptor.js — MAIN world, runs before Disney+ scripts
// Intercepts VTT subtitle responses and forwards them to content.js

// Force all shadow roots to open mode so content scripts can access them
const _attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(init) {
  return _attachShadow.call(this, { ...init, mode: 'open' });
};

const SUBTITLE_RE = /\.(vtt|ttml)(\?|$)/i;
const seen = new Set();

function isSubtitle(url) {
  if (typeof url !== 'string') return false;
  if (/\.(m4s|m3u8|mpd|mp4|mp3|jpg|png|svg|woff|css|js)(\?|$)/i.test(url)) return false;
  return SUBTITLE_RE.test(url) || /subtitles?\/|captions?\//i.test(url);
}

function dispatch(url, text) {
  if (!text || !text.includes('WEBVTT')) return;
  const key = url.split('?')[0];
  if (seen.has(key)) return;
  seen.add(key);
  window.dispatchEvent(new CustomEvent('DPVT_SUBTITLE', { detail: { url, text } }));
}

window.addEventListener('DPVT_RESET', () => seen.clear());

// Intercept fetch
const _fetch = window.fetch;
window.fetch = async (...args) => {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
  const res = await _fetch(...args);
  if (isSubtitle(url)) res.clone().text().then(t => dispatch(url, t)).catch(() => {});
  return res;
};

// Intercept XHR
const _open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
  if (isSubtitle(String(url))) {
    this.addEventListener('load', () => dispatch(String(url), this.responseText));
  }
  return _open.apply(this, arguments);
};
