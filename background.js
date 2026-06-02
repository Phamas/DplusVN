// background.js — service worker
// Receives an array of subtitle texts, sends to GAS as JSON, returns translated array.

const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyXTkJY7DjflLRE1e1coouwyW5eeKr9mCPnvOAdL9NMUvnt-gehD0IoglrDlN946UlS9w/exec';

let isTranslating = false;
const queue = [];

function enqueue(texts, resolve, reject) {
  queue.push({ texts, resolve, reject });
  processQueue();
}

async function processQueue() {
  if (isTranslating || queue.length === 0) return;
  isTranslating = true;
  const { texts, resolve, reject } = queue.shift();
  try {
    const result = await callGAS(texts);
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    isTranslating = false;
    processQueue();
  }
}

async function callGAS(texts) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      // Send as a JSON array — GAS returns a JSON array back.
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`GAS HTTP ${response.status}`);

    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Unknown GAS error');

    // Expect data.translated to be an array matching texts.length
    if (Array.isArray(data.translated)) {
      return data.translated;
    }

    // Fallback: if GAS still returns a single translatedText string,
    // try to split it — this handles old GAS versions gracefully.
    if (typeof data.translatedText === 'string') {
      console.warn('[D+VT bg] GAS returned string, not array — update your GAS script');
      return texts; // fall back to English
    }

    throw new Error('Unexpected GAS response format');
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== 'TRANSLATE_BATCH') return false;

  const texts = request.texts;
  if (!Array.isArray(texts) || texts.length === 0) {
    sendResponse({ success: false, translated: [] });
    return true;
  }

  new Promise((resolve, reject) => {
    enqueue(texts, resolve, reject);
  })
    .then(translated => {
      sendResponse({ success: true, translated });
    })
    .catch(err => {
      console.error('[D+VT] Translation failed:', err.message);
      sendResponse({ success: false, translated: [] });
    });

  return true;
});