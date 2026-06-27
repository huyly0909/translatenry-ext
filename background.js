/**
 * Background Service Worker — Translatenry
 *
 * - Registers the "Translatenry" right-click menu (selection only).
 * - Auto-detects single word vs. phrase:
 *     single word → tell the page to show a Cambridge dictionary overlay
 *     phrase      → run the AI provider, then push the result into a page overlay
 * - Handles popup-initiated AI translation via runtime messaging.
 *
 * All Ollama fetches happen HERE (extension origin + host_permissions), never
 * in the page content script (which would hit the page's CORS policy).
 */

importScripts('providers.js');

const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org/vi/dictionary/english/';

// ── Context menu ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'translatenry',
    title: 'Translatenry',
    contexts: ['selection'],
  });
});

// A "single word": no internal whitespace, letters plus optional - or '.
function isSingleWord(text) {
  const t = (text || '').trim();
  return t.length > 0 && !/\s/.test(t) && /^[A-Za-z][A-Za-z'’-]*$/.test(t);
}

function cambridgeUrl(word) {
  const clean = word.toLowerCase().replace(/[^a-z'’-]/g, '');
  return CAMBRIDGE_BASE + encodeURIComponent(clean);
}

// ── Context menu handler ────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'translatenry') return;
  const sel = (info.selectionText || '').trim();
  if (!sel || !tab || !tab.id) return;

  if (isSingleWord(sel)) {
    const word = sel.toLowerCase().replace(/[^a-z'’-]/g, '');
    chrome.tabs.create({ url: cambridgeUrl(word) });
    return;
  }

  // Phrase → AI translate.
  await sendToPage(tab.id, { type: 'overlayLoading', text: sel });
  try {
    const settings = await chrome.storage.local.get(Providers.DEFAULTS);
    const result = await Providers.translate(sel, settings);
    await sendToPage(tab.id, { type: 'overlayResult', text: sel, result });
  } catch (e) {
    await sendToPage(tab.id, { type: 'overlayError', error: e.message });
  }
});

// ── Popup-initiated AI translation ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    (async () => {
      try {
        const settings = await chrome.storage.local.get(Providers.DEFAULTS);
        const result = await Providers.translate(msg.text, settings);
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // keep the channel open for the async response
  }
  return false;
});

// ── Messaging helper ────────────────────────────────────────────────
// content.js is declared in the manifest, but a tab open BEFORE install
// won't have it yet — inject on demand and retry once.

async function sendToPage(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      await chrome.tabs.sendMessage(tabId, payload);
    } catch (e2) {
      // Page can't host a content script (e.g. chrome:// or the Web Store) — ignore.
    }
  }
}
