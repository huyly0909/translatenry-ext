/**
 * popup.js - Translatenry popup logic.
 *
 * Tabs: Cambridge (link to new tab) - AI (translate & learn) - Settings.
 * Settings auto-save on blur if content changed, or Enter.
 * Escape closes the popup.
 */

const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org/vi/dictionary/english/';
const DEFAULTS = Providers.DEFAULTS;

let settings = { ...DEFAULTS };

// -- Element refs -------------------------------------------------------
const $ = (id) => document.getElementById(id);

const tabBar = $('tabBar');
const toggleIndicator = $('toggleIndicator');

// Cambridge
const camInput = $('camInput');
const camLookup = $('camLookup');
const camEmpty = $('camEmpty');

// AI
const aiInput = $('aiInput');
const aiTranslate = $('aiTranslate');
const aiResult = $('aiResult');

// Settings
const providerType = $('providerType');
const ollamaGroup = $('ollamaGroup');
const ollamaModel = $('ollamaModel');
const ollamaUrl = $('ollamaUrl');
const refreshModels = $('refreshModels');
const testBtn = $('testBtn');
const testStatus = $('testStatus');
const targetLanguage = $('targetLanguage');
const aiPrompt = $('aiPrompt');
const resetPrompt = $('resetPrompt');
const ollamaSetup = $('ollamaSetup');
const ollamaDownloadLink = $('ollamaDownloadLink');
const copyCmdBtn = $('copyCmdBtn');
const copyPermanentBtn = $('copyPermanentBtn');
const copyPullBtn = $('copyPullBtn');

// Toasts
const toast = $('toast');
const toastMsg = $('toastMsg');
const toastError = $('toastError');
const toastErrorMsg = $('toastErrorMsg');

// -- Tabs ---------------------------------------------------------------

const TAB_INDEX = { cambridge: 0, ai: 1, settings: 2 };

function switchTab(name) {
  document.querySelectorAll('.toggle-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  toggleIndicator.style.transform = `translateX(${TAB_INDEX[name] * 100}%)`;
  document.querySelectorAll('.section').forEach((s) =>
    s.classList.toggle('hidden', s.id !== `tab-${name}`));
  if (name === 'settings') fetchModelList();
}

tabBar.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (btn && btn.dataset.tab) switchTab(btn.dataset.tab);
});

// -- Cambridge ----------------------------------------------------------

function sanitizeWord(raw) {
  return (raw || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z'\u2019-]/g, '');
}

function lookupCambridge() {
  const word = sanitizeWord(camInput.value);
  if (!word) return;
  const url = CAMBRIDGE_BASE + encodeURIComponent(word);

  // Open directly in a new tab and switch to it
  chrome.tabs.create({ url, active: true });
}

camLookup.addEventListener('click', lookupCambridge);
camInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupCambridge(); });

// -- AI translate -------------------------------------------------------

let currentAbort = null; // AbortController for the ongoing request

async function doTranslate() {
  const text = aiInput.value.trim();
  if (!text) return;

  // Cancel any previous ongoing request
  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();
  const signal = currentAbort.signal;

  aiResult.classList.remove('hidden');
  aiResult.innerHTML = '<div class="ai-streaming"><span class="stream-text"></span><span class="stream-cursor">▌</span></div>';
  aiTranslate.disabled = true;
  const streamEl = aiResult.querySelector('.stream-text');
  try {
    const s = await chrome.storage.local.get(Providers.DEFAULTS);
    await Providers.translateStream(text, s,
      function onToken(token) {
        streamEl.textContent += token;
        // Auto-scroll to bottom
        aiResult.scrollTop = aiResult.scrollHeight;
      },
      function onDone(full) {
        // Re-render with nice section formatting
        aiResult.innerHTML = renderSections(full);
      },
      signal
    );
  } catch (e) {
    if (e.name === 'AbortError') return; // cancelled, don't show error
    aiResult.innerHTML = '<div class="ai-error">' + escapeHtml(e.message || 'Translation failed.') + '</div>';
  } finally {
    currentAbort = null;
    aiTranslate.disabled = false;
  }
}

aiTranslate.addEventListener('click', doTranslate);
aiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doTranslate(); }
});

function renderSections(raw) {
  const text = (raw || '').trim();
  if (!text) return '<div class="sec"><p>(empty response)</p></div>';
  const re = /^\s*\d+\.\s+(.+)$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    heads.push({ title: m[1].trim(), start: m.index, contentStart: re.lastIndex });
  }
  if (heads.length === 0) return '<div class="sec"><p>' + escapeHtml(text) + '</p></div>';
  let html = '';
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const content = text.slice(heads[i].contentStart, end).trim();
    html += '<div class="sec"><h4>' + escapeHtml(heads[i].title) + '</h4>' +
      (content ? '<p>' + escapeHtml(content) + '</p>' : '') + '</div>';
  }
  return html;
}

// -- Model list: fetch from Ollama API + 3-minute cache -----------------

let modelCache = { models: [], ts: 0 };
const MODEL_CACHE_TTL = 3 * 60 * 1000;

async function fetchModelList(force) {
  var now = Date.now();
  if (!force && modelCache.models.length > 0 && now - modelCache.ts < MODEL_CACHE_TTL) return;

  refreshModels.classList.add('spinning');
  try {
    var baseUrl = ollamaUrl.value.trim() || 'http://localhost:11434';
    var models = await Providers.listModels(baseUrl);
    var names = models.map(function(m) { return m.name || m.model; }).filter(Boolean).sort();
    modelCache = { models: names, ts: Date.now() };
    populateModelDropdown(names);
  } catch (e) {
    if (ollamaModel.options.length <= 1) {
      populateModelDropdown([
        'qwen3:4b', 'qwen3:8b', 'gemma3:4b', 'gemma3:12b',
        'llama3.2:3b', 'mistral-small3', 'aya-expanse:8b', 'aya-expanse:32b',
      ]);
    }
  } finally {
    refreshModels.classList.remove('spinning');
  }
}

function populateModelDropdown(names) {
  var saved = settings.ollamaModel || 'qwen3:4b';
  ollamaModel.innerHTML = '';
  var seen = {};
  var uniqueNames = [];
  if (!names.some(function(n) { return n === saved; })) uniqueNames.push(saved);
  names.forEach(function(n) { if (!seen[n]) { seen[n] = true; uniqueNames.push(n); } });
  for (var i = 0; i < uniqueNames.length; i++) {
    var opt = document.createElement('option');
    opt.value = uniqueNames[i];
    opt.textContent = uniqueNames[i];
    ollamaModel.appendChild(opt);
  }
  ollamaModel.value = saved;
}

refreshModels.addEventListener('click', function() { fetchModelList(true); });

// -- Settings: load, render, auto-save ----------------------------------

async function loadSettings() {
  settings = await chrome.storage.local.get(DEFAULTS);
  providerType.value = settings.providerType || 'ollama';
  ollamaUrl.value = settings.ollamaUrl || '';
  targetLanguage.value = settings.targetLanguage || 'Vietnamese';
  aiPrompt.value = settings.aiPrompt || Providers.DEFAULT_PROMPT;
  updateProviderVisibility();
  await fetchModelList();
  ollamaModel.value = settings.ollamaModel || 'qwen3:4b';
}

function updateProviderVisibility() {
  var isOllama = providerType.value === 'ollama';
  ollamaGroup.classList.toggle('hidden', !isOllama);
  ollamaSetup.classList.toggle('hidden', !isOllama);
}

async function saveField(key, value) {
  settings[key] = value;
  await chrome.storage.local.set({ [key]: value });
  showToast('Saved');
}

function bindAutoSave(el, key, opts) {
  var multiline = opts && opts.multiline;
  var lastSaved = el.value;
  el.addEventListener('focus', function() { lastSaved = el.value; });
  el.addEventListener('blur', function() {
    if (el.value !== lastSaved) {
      lastSaved = el.value;
      saveField(key, el.value);
    }
  });
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      if (multiline) e.preventDefault();
      el.blur();
    }
  });
}

bindAutoSave(ollamaUrl, 'ollamaUrl');
bindAutoSave(aiPrompt, 'aiPrompt', { multiline: true });

ollamaModel.addEventListener('change', function() {
  saveField('ollamaModel', ollamaModel.value);
});

targetLanguage.addEventListener('change', function() {
  saveField('targetLanguage', targetLanguage.value);
});

providerType.addEventListener('change', function() {
  updateProviderVisibility();
  saveField('providerType', providerType.value);
});

resetPrompt.addEventListener('click', function() {
  aiPrompt.value = Providers.DEFAULT_PROMPT;
  saveField('aiPrompt', Providers.DEFAULT_PROMPT);
});

// -- Ollama setup guide -------------------------------------------------

ollamaDownloadLink.addEventListener('click', function(e) {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://ollama.com/download' });
});

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    btn.classList.add('copied');
    showToast('Copied!');
    setTimeout(function() { btn.classList.remove('copied'); }, 1500);
  });
}

copyCmdBtn.addEventListener('click', function() {
  copyToClipboard($('setupCmd').textContent, copyCmdBtn);
});

copyPermanentBtn.addEventListener('click', function() {
  copyToClipboard($('setupPermanentCmd').textContent, copyPermanentBtn);
});

copyPullBtn.addEventListener('click', function() {
  var model = ollamaModel.value.trim() || 'qwen3:4b';
  copyToClipboard('ollama pull ' + model, copyPullBtn);
});

// -- Test button --------------------------------------------------------

testBtn.addEventListener('click', async function() {
  setTestStatus('info', 'Testing...');
  testBtn.disabled = true;
  var live = Object.assign({}, settings, {
    providerType: providerType.value,
    ollamaModel: ollamaModel.value.trim(),
    ollamaUrl: ollamaUrl.value.trim(),
  });
  try {
    var msg = await Providers.test(live);
    setTestStatus('success', msg);
  } catch (e) {
    setTestStatus('error', e.message);
  } finally {
    testBtn.disabled = false;
  }
});

function setTestStatus(kind, msg) {
  testStatus.className = 'test-status ' + kind;
  testStatus.textContent = msg;
}

// -- Toasts -------------------------------------------------------------

let toastTimer = null;
function showToast(msg) {
  toastMsg.textContent = msg;
  toast.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { toast.classList.remove('visible'); }, 1400);
}

let toastErrTimer = null;
function showError(msg) {
  toastErrorMsg.textContent = msg;
  toastError.classList.add('visible');
  if (toastErrTimer) clearTimeout(toastErrTimer);
  toastErrTimer = setTimeout(function() { toastError.classList.remove('visible'); }, 2600);
}

// -- Utils --------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -- Escape to close popup -----------------------------------------------
// window.close() doesn't work in Chrome MV3 popups.
// Blurring the window causes Chrome to auto-close the popup.

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    // Abort any ongoing AI request first
    if (currentAbort) currentAbort.abort();
    // Blur the popup window — Chrome auto-closes popups on blur
    window.blur();
  }
}, true); // capture phase

// Abort ongoing request when popup is about to close
window.addEventListener('beforeunload', () => {
  if (currentAbort) currentAbort.abort();
});

// -- Init ---------------------------------------------------------------

loadSettings();
camInput.focus();
