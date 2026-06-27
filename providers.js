/**
 * providers.js — LLM provider abstraction for Translatenry.
 *
 * Exposes a global `Providers` so the SAME file works in:
 *   - the popup        → loaded via <script src="providers.js">
 *   - the service worker → loaded via importScripts('providers.js')
 *
 * Active provider: Ollama (local). OpenAI / Google are reserved (UI disabled).
 * All network calls run in an extension context (popup or service worker),
 * which has `host_permissions` — never call these from a page content script.
 */
(function (root) {
  'use strict';

  // ── Default English-learning assistant prompt ───────────────────────
  // `{{TARGET}}` is replaced with the configured target language (default Vietnamese).
  const DEFAULT_PROMPT = `You are "Translatenry", a warm, precise English tutor for a {{TARGET}}-speaking learner.
The user gives you English text. Your job is NOT only to translate it — it is to help them
LEARN English from it. Write explanations in {{TARGET}}, and keep the words/phrases being taught in English.

Respond using EXACTLY these sections, with these headers, in this order:

1. Translation ({{TARGET}})
   - A natural, fluent {{TARGET}} translation of the whole text. Idiomatic, not word-for-word.

2. Literal note
   - Only if the natural translation hides the English structure, add a short literal gloss so the
     learner sees how the English is built. Skip this section entirely if the text is simple.

3. Key vocabulary
   - 3 to 8 of the most useful or difficult words/phrases from the text. One per line, format:
     • English word/phrase — part of speech — /IPA/ — {{TARGET}} meaning
   - Prefer reusable everyday words, not proper nouns.

4. Grammar & usage notes
   - 1 to 3 short, concrete notes about grammar, tense, collocation, register (formal/informal),
     or a common mistake a {{TARGET}} speaker would make. Be specific to THIS text.

5. Example sentences
   - 2 NEW English sentences that reuse a key word/phrase in a different context,
     each followed by its {{TARGET}} translation in parentheses.

Rules:
- Be concise. This is a quick pop-up helper, not an essay. No preamble, no "Sure!", no sign-off.
- Never invent meanings. If a word is ambiguous, give the most likely meaning for the context
  and briefly note the alternative.
- Keep IPA in /slashes/. Keep English terms in their original spelling.
- If the input is a single word, still follow the sections but make section 1 the dictionary-style
  {{TARGET}} meaning(s), and lean on vocabulary, pronunciation, and example sentences.
- Output plain text with the numbered headers above. Do NOT use Markdown tables.

/no_think`;

  // ── Helpers ─────────────────────────────────────────────────────────

  function normBase(url) {
    return (url || 'http://localhost:11434').trim().replace(/\/+$/, '');
  }

  function buildSystemPrompt(settings) {
    const prompt = (settings.aiPrompt && settings.aiPrompt.trim()) || DEFAULT_PROMPT;
    const target = settings.targetLanguage || 'Vietnamese';
    return prompt.replace(/\{\{TARGET\}\}/g, target);
  }

  // ── Ollama ──────────────────────────────────────────────────────────

  function ollamaFetchRaw(baseUrl, model, system, user, stream, signal) {
    const base = normBase(baseUrl);
    return fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: !!stream,
      }),
      signal: signal || undefined,
    }).then(function (res) {
      if (res.status === 403) {
        throw new Error(
          'Ollama rejected the extension origin (403). Restart Ollama with ' +
            'OLLAMA_ORIGINS="chrome-extension://*" set. See the README for steps.'
        );
      }
      if (!res.ok) {
        return res.text().catch(function () { return ''; }).then(function (detail) {
          throw new Error('Ollama error ' + res.status + (detail ? ': ' + detail.slice(0, 200) : ''));
        });
      }
      return res;
    }).catch(function (e) {
      if (e.name === 'AbortError') throw e;
      if (e.message && e.message.indexOf('Ollama') >= 0) throw e;
      if (e.message && e.message.indexOf('error') >= 0) throw e;
      throw new Error('Cannot reach Ollama at ' + base + '. Is "ollama serve" running? (' + e.message + ')');
    });
  }

  async function ollamaChat(baseUrl, model, system, user) {
    const res = await ollamaFetchRaw(baseUrl, model, system, user, false);
    const data = await res.json();
    const content = data && data.message && data.message.content;
    if (!content) throw new Error('Ollama returned an empty response.');
    return content.trim();
  }

  /**
   * Stream chat tokens. Calls onToken(string) for each chunk,
   * and onDone(fullText) when complete. Throws on error.
   */
  async function ollamaChatStream(baseUrl, model, system, user, onToken, onDone, signal) {
    const res = await ollamaFetchRaw(baseUrl, model, system, user, true, signal);

    // Fallback: if ReadableStream body not available, read as whole JSON
    if (!res.body || typeof res.body.getReader !== 'function') {
      const data = await res.json();
      const content = (data && data.message && data.message.content) || '';
      if (content && onToken) onToken(content);
      if (onDone) onDone(content);
      return content;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buf = '';

    // If abort signal fires, cancel the reader
    if (signal) {
      signal.addEventListener('abort', function () {
        reader.cancel().catch(function () {});
      }, { once: true });
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Ollama streams newline-delimited JSON
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete last line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            const token = obj.message && obj.message.content;
            if (token) {
              full += token;
              if (onToken) onToken(token);
            }
          } catch (_) { /* skip malformed line */ }
        }
      }
      // Process any remaining buffer
      if (buf.trim()) {
        try {
          const obj = JSON.parse(buf);
          const token = obj.message && obj.message.content;
          if (token) { full += token; if (onToken) onToken(token); }
        } catch (_) { /* skip */ }
      }
    } catch (e) {
      if (e.name === 'AbortError' || (signal && signal.aborted)) {
        // Request was cancelled — don't call onDone
        return full;
      }
      throw e;
    }
    if (onDone) onDone(full);
    return full;
  }

  async function ollamaTags(baseUrl) {
    const base = normBase(baseUrl);
    let res;
    try {
      res = await fetch(base + '/api/tags');
    } catch (e) {
      throw new Error(`Cannot reach Ollama at ${base}. Start it with "ollama serve".`);
    }
    if (res.status === 403) {
      throw new Error(
        'Ollama rejected the extension origin (403). Restart Ollama with ' +
          'OLLAMA_ORIGINS="chrome-extension://*" set.'
      );
    }
    if (!res.ok) throw new Error(`Ollama error ${res.status}.`);
    const data = await res.json();
    return (data && data.models) || [];
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Translate + teach. Returns the model's raw text (non-streaming). */
  async function translate(text, settings) {
    const s = settings || {};
    const system = buildSystemPrompt(s);
    const user = `Text to translate and teach:\n"""\n${text}\n"""`;

    switch (s.providerType) {
      case 'ollama':
        return ollamaChat(s.ollamaUrl, s.ollamaModel || 'qwen3:4b', system, user);
      case 'openai':
      case 'google':
        throw new Error(`The "${s.providerType}" provider is not enabled yet.`);
      default:
        throw new Error('No provider configured. Open Settings and choose Ollama.');
    }
  }

  /** Translate + teach with token streaming. onToken(str), onDone(full). Optional signal for abort. */
  async function translateStream(text, settings, onToken, onDone, signal) {
    const s = settings || {};
    const system = buildSystemPrompt(s);
    const user = `Text to translate and teach:\n"""\n${text}\n"""`;

    switch (s.providerType) {
      case 'ollama':
        return ollamaChatStream(s.ollamaUrl, s.ollamaModel || 'qwen3:4b', system, user, onToken, onDone, signal);
      case 'openai':
      case 'google':
        throw new Error(`The "${s.providerType}" provider is not enabled yet.`);
      default:
        throw new Error('No provider configured. Open Settings and choose Ollama.');
    }
  }

  /** Verify the provider + model are reachable and working. Returns a status string. */
  async function test(settings) {
    const s = settings || {};
    if (s.providerType !== 'ollama') {
      throw new Error(`The "${s.providerType}" provider is not enabled yet.`);
    }
    const model = (s.ollamaModel || '').trim() || 'qwen3:4b';
    const models = await ollamaTags(s.ollamaUrl);
    const names = models.map((m) => m.name || m.model).filter(Boolean);
    const installed =
      names.includes(model) || names.some((n) => n === model || n.startsWith(model + ':'));
    if (!installed) {
      throw new Error(
        `Connected, but model "${model}" is not installed.\nRun:  ollama pull ${model}\n` +
          `Installed: ${names.length ? names.join(', ') : 'none'}.`
      );
    }
    // Tiny round-trip to confirm generation actually works.
    await ollamaChat(s.ollamaUrl, model, 'You are a connection test.', 'Reply with the single word OK.');
    return `OK — ${model} is ready.`;
  }

  // ── Default settings (single source of truth) ───────────────────────
  // Load with: chrome.storage.local.get(Providers.DEFAULTS)
  const DEFAULTS = {
    providerType: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen3:4b',
    openaiKey: '',
    openaiModel: 'gpt-4o-mini',
    googleKey: '',
    googleModel: 'gemini-1.5-flash',
    targetLanguage: 'Vietnamese',
    aiPrompt: DEFAULT_PROMPT,
  };

  root.Providers = { translate, translateStream, test, listModels: ollamaTags, DEFAULT_PROMPT, DEFAULTS };
})(typeof self !== 'undefined' ? self : this);
