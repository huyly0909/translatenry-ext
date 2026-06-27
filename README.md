# Translatenry

A Chrome extension for **learning English**, not just translating it. Built for Vietnamese
speakers (English → Vietnamese).

- **Cambridge tab** — quick single-word dictionary lookup (embedded Cambridge entry).
- **AI tab** — paste a word/phrase/sentence and get a translation **plus** vocabulary,
  grammar notes, pronunciation, and example sentences, powered by your **local Ollama**.
- **Settings tab** — pick the Ollama model (with a built-in model comparison `?` table),
  set the base URL, edit the AI prompt, and **test** the connection.
- **Right-click "Translatenry"** — select text on any page:
  - a **single word** → a floating Cambridge dictionary card,
  - a **phrase/sentence** → an AI translation card.

Pure Manifest V3, vanilla JS/HTML/CSS — no build step, no npm dependencies.

---

## Install (load unpacked)

```bash
make build          # outputs dist/unpacked/
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select `dist/unpacked/`

(You can also load this source folder directly during development.)

---

## Ollama setup (required for the AI features)

1. Install & start Ollama, then pull a model:

   ```bash
   ollama serve
   ollama pull qwen3:4b      # default; see the table below for alternatives
   ```

2. **Allow the extension's origin (critical).** Ollama rejects browser-extension
   requests with `403` unless you allow the `chrome-extension://` origin:

   - macOS:
     ```bash
     launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
     # then quit & reopen the Ollama app (or restart `ollama serve`)
     ```
   - Or run the server with it inline:
     ```bash
     OLLAMA_ORIGINS="chrome-extension://*" ollama serve
     ```

3. In the extension **Settings** tab, click **Test** — you should see
   `OK — <model> is ready.` If you get a `403`, revisit step 2.

### Model comparison

| Model           | Size | Speed | Translation Quality | RAM (4-bit) | Best Use                  |
| --------------- | ---: | :---: | :-----------------: | ----------: | ------------------------- |
| Qwen3 4B        |   4B | ⭐⭐⭐⭐⭐ |        ⭐⭐⭐⭐☆        |       ~3 GB | Best balance (default)    |
| Qwen3 8B        |   8B | ⭐⭐⭐⭐☆ |        ⭐⭐⭐⭐⭐        |       ~6 GB | Excellent translation     |
| Gemma 3 4B      |   4B | ⭐⭐⭐⭐⭐ |        ⭐⭐⭐⭐☆        |       ~3 GB | Very natural English      |
| Gemma 3 12B     |  12B |  ⭐⭐⭐☆ |        ⭐⭐⭐⭐⭐        |       ~9 GB | Near cloud quality        |
| Llama 3.2 3B    |   3B | ⭐⭐⭐⭐⭐ |        ⭐⭐⭐☆☆        |       ~2 GB | Fastest                   |
| Mistral Small 3 |  24B |  ⭐⭐☆  |        ⭐⭐⭐⭐⭐        |      ~16 GB | High-quality multilingual |
| Aya Expanse 8B  |   8B | ⭐⭐⭐⭐☆ |        ⭐⭐⭐⭐⭐        |       ~6 GB | Translation specialist    |
| Aya Expanse 32B |  32B |  ⭐⭐☆  |        ⭐⭐⭐⭐⭐        |      ~22 GB | Professional translation  |

RAM figures are approximate (4-bit quantization).

---

## Notes & known limitations

- **Cambridge in an iframe:** the site sends `X-Frame-Options` / bot protection. The
  extension strips those headers for `dictionary.cambridge.org` sub-frames via
  `declarativeNetRequest` (best effort). If embedding still fails, every Cambridge view
  has an **"Open in a new tab"** fallback.
- **Privacy:** AI requests go only to your configured Ollama server (local by default).
  Nothing is sent to any cloud service.
- OpenAI / Google providers are scaffolded but **disabled** for now.

---

## Project layout

```
translatenry-ext/
├── manifest.json     # MV3 config
├── rules.json        # declarativeNetRequest: unblock Cambridge iframes
├── providers.js      # LLM abstraction (Ollama) + default learning prompt + DEFAULTS
├── background.js     # context menu + word detection + message routing
├── content.js        # in-page floating overlay (Shadow DOM)
├── content.css       # overlay host guard (styling lives in the shadow root)
├── popup.html/.css/.js   # 3-tab popup UI
├── icons/            # 16 / 48 / 128 px
└── Makefile          # make build | clean | list
```
