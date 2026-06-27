/**
 * content.js — in-page floating overlay for Translatenry.
 *
 * Listens for messages from the background service worker and renders a single
 * draggable card (isolated in a Shadow DOM so host-page CSS can't leak in):
 *   overlayCambridge → embedded Cambridge iframe (+ "open in new tab" fallback)
 *   overlayLoading   → spinner while the AI runs
 *   overlayResult    → formatted AI translation/learning output
 *   overlayError     → error message
 */
(function () {
  'use strict';

  const HOST_ID = '__translatenry_overlay_host';
  let hostEl = null; // the <div> attached to the page
  let rootEl = null; // its shadow root

  const SHADOW_STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card {
      position: fixed; top: 20px; right: 20px; width: 400px; max-width: calc(100vw - 40px);
      max-height: calc(100vh - 40px); display: flex; flex-direction: column;
      background: #13131d; color: #e8e8f0; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,0.5); overflow: hidden;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; line-height: 1.55; z-index: 2147483647;
      animation: tnFade 180ms ease-out;
    }
    @keyframes tnFade { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    .hd {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: move;
      background: linear-gradient(135deg, rgba(168,85,247,0.18), rgba(6,182,212,0.12));
      border-bottom: 1px solid rgba(255,255,255,0.06); user-select: none;
    }
    .hd .dot { width: 8px; height: 8px; border-radius: 50%;
      background: linear-gradient(135deg,#a855f7,#06b6d4); flex: none; }
    .ttl { font-weight: 700; font-size: 13px; flex: 1; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; }
    .x { width: 24px; height: 24px; flex: none; border: none; background: rgba(255,255,255,0.06);
      color: #b9b9d0; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1;
      display: flex; align-items: center; justify-content: center; }
    .x:hover { background: rgba(255,255,255,0.14); color: #fff; }
    .body { padding: 12px 14px; overflow: auto; flex: 1; }
    .body iframe { width: 100%; height: 460px; border: 0; border-radius: 8px; background: #fff; }
    .spinner { display: flex; align-items: center; gap: 10px; color: #8888a8; padding: 18px 4px; }
    .ring { width: 18px; height: 18px; border: 2px solid rgba(168,85,247,0.25);
      border-top-color: #a855f7; border-radius: 50%; animation: tnSpin 700ms linear infinite; }
    @keyframes tnSpin { to { transform: rotate(360deg); } }
    .src { font-size: 11px; color: #5a5a78; margin: 0 0 10px; word-break: break-word; }
    .sec { margin: 0 0 12px; }
    .sec h4 { margin: 0 0 4px; font-size: 12px; font-weight: 700; color: #c8a6f5;
      text-transform: none; letter-spacing: 0; }
    .sec p { margin: 0; white-space: pre-wrap; }
    .err { color: #f87171; white-space: pre-wrap; }
    .fallback { text-align: center; padding: 18px 8px; }
    .fallback p { margin: 0 0 12px; color: #8888a8; }
    .btn { display: inline-block; background: linear-gradient(135deg,#a855f7,#06b6d4); color: #fff;
      text-decoration: none; font-weight: 600; font-size: 12px; padding: 9px 18px; border-radius: 8px;
      border: none; cursor: pointer; }
    .btn:hover { opacity: 0.92; }
  `;

  function ensureOverlay() {
    if (hostEl && document.documentElement.contains(hostEl)) return rootEl;
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    rootEl = hostEl.attachShadow({ mode: 'open' });
    rootEl.innerHTML = `
      <style>${SHADOW_STYLES}</style>
      <div class="card">
        <div class="hd" part="hd">
          <span class="dot"></span>
          <span class="ttl">Translatenry</span>
          <button class="x" title="Close">×</button>
        </div>
        <div class="body"></div>
      </div>`;
    rootEl.querySelector('.x').addEventListener('click', closeOverlay);
    makeDraggable(rootEl.querySelector('.card'), rootEl.querySelector('.hd'));
    document.documentElement.appendChild(hostEl);
    return rootEl;
  }

  function closeOverlay() {
    if (hostEl) hostEl.remove();
    hostEl = null;
    rootEl = null;
  }

  function setTitle(text) {
    rootEl.querySelector('.ttl').textContent = text;
  }

  function getBody() {
    return rootEl.querySelector('.body');
  }

  // Drag the card by its header.
  function makeDraggable(card, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('x')) return;
      dragging = true;
      const r = card.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      card.style.right = 'auto';
      card.style.left = ox + 'px';
      card.style.top = oy + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      card.style.left = ox + (e.clientX - sx) + 'px';
      card.style.top = oy + (e.clientY - sy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // ── Renderers ─────────────────────────────────────────────────────

  function renderCambridge(word, url) {
    setTitle('Cambridge · ' + word);
    const body = getBody();
    body.innerHTML = `<iframe src="${escapeAttr(url)}" referrerpolicy="no-referrer"></iframe>`;
    const iframe = body.querySelector('iframe');
    let loaded = false;
    const timer = setTimeout(() => { if (!loaded) showCambridgeFallback(body, url); }, 4500);
    iframe.addEventListener('load', () => { loaded = true; clearTimeout(timer); });
    iframe.addEventListener('error', () => { clearTimeout(timer); showCambridgeFallback(body, url); });
  }

  function showCambridgeFallback(body, url) {
    body.innerHTML = `
      <div class="fallback">
        <p>Cambridge couldn't be embedded here (the site blocks iframes).</p>
        <a class="btn" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Open in a new tab →</a>
      </div>`;
  }

  function renderLoading() {
    setTitle('Translatenry · AI');
    getBody().innerHTML = `<div class="spinner"><span class="ring"></span><span>Translating &amp; explaining…</span></div>`;
  }

  function renderResult(text, result) {
    setTitle('Translatenry · AI');
    const body = getBody();
    const src = text ? `<p class="src">“${escapeHtml(truncate(text, 140))}”</p>` : '';
    body.innerHTML = src + renderSections(result);
  }

  function renderError(message) {
    setTitle('Translatenry · AI');
    getBody().innerHTML = `<div class="err">${escapeHtml(message)}</div>`;
  }

  // Split the model output into "1. Header\n body" sections; fall back to raw text.
  function renderSections(raw) {
    const text = (raw || '').trim();
    if (!text) return `<p>(empty response)</p>`;
    const re = /^\s*\d+\.\s+(.+)$/gm;
    const heads = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      heads.push({ title: m[1].trim(), start: m.index, contentStart: re.lastIndex });
    }
    if (heads.length === 0) {
      return `<div class="sec"><p>${escapeHtml(text)}</p></div>`;
    }
    let html = '';
    for (let i = 0; i < heads.length; i++) {
      const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
      const content = text.slice(heads[i].contentStart, end).trim();
      html += `<div class="sec"><h4>${escapeHtml(heads[i].title)}</h4>` +
        (content ? `<p>${escapeHtml(content)}</p>` : '') + `</div>`;
    }
    return html;
  }

  // ── Utils ─────────────────────────────────────────────────────────

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ── Message router ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'overlayLoading': ensureOverlay(); renderLoading(); break;
      case 'overlayResult': ensureOverlay(); renderResult(msg.text, msg.result); break;
      case 'overlayError': ensureOverlay(); renderError(msg.error); break;
    }
  });
})();
