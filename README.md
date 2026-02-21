<p align="center">
  <h1 align="center">Portex</h1>
  <p align="center"><strong>Portable Context — carry your AI conversations anywhere</strong></p>
  <p align="center">
    Save, summarize, and inject chat context across ChatGPT, Claude, and Gemini.<br />
    Go + WebAssembly core. Chrome MV3 extension. Zero backend. Your data never leaves your browser.
  </p>
</p>

---

## What is Portex?

Portex is a Chrome extension that lets you save a conversation from one AI provider, summarize it, and inject that context into a different provider — in one click. No more copy-pasting walls of text between tabs.

**Core loop:** Save Chat → Summarize → Inject into another provider

## Features

- **Save** — capture full conversations from ChatGPT, Claude, or Gemini with one click
- **Summarize** — local 3-tier compression (no API key needed) or AI-powered via your own OpenAI/Anthropic key
- **Inject** — paste formatted context into any provider's chat input automatically
- **Search** — find sessions by keyword across titles, tags, and message content
- **Export** — download sessions as JSON
- **Private** — all data lives in `chrome.storage.local`, no backend, no analytics

## Architecture

```
portex/
  extension/          JS — Chrome MV3 thin glue layer
    manifest.json     Extension manifest (MV3, wasm-unsafe-eval CSP)
    popup.html        Popup UI
    popup.js          Controller (storage, actions, rendering)
    scraper.js        Content script — scrapes DOM messages per provider
    injector.js       Content script — pastes context into chat input
    wasm_bridge.js    Loads Go WASM, exposes async API
    wasm_exec.js      Go runtime helper (auto-generated)
    portex.wasm       Compiled binary (auto-generated)

  wasm/               Go — core logic compiled to WASM
    main.go           Registers exported functions, keeps runtime alive
    parser.go         Raw scraped messages → structured Session
    summarizer.go     Layered compression + OpenAI/Anthropic API calls
    storage.go        UUID gen, serialize/deserialize, keyword search
    injector.go       Formats provider-specific inject prompts
    Makefile          Build commands

  landing/            Static site (Vercel / GitHub Pages)
    index.html
    privacy.html
```

## Quick Start

### Prerequisites

- [Go 1.22+](https://go.dev/dl/)
- Chrome or Chromium-based browser

### Build

```bash
cd wasm
make build
```

This compiles Go → `extension/portex.wasm` and copies `wasm_exec.js` from your Go installation.

### Load the Extension

1. Open `chrome://extensions`
3. Enable **Developer Mode**
4. Click **Load unpacked** → select the `extension/` folder

### Optional: Compress WASM Binary

```bash
brew install binaryen
cd wasm
make compress
```

## WASM API

All Go functions are registered on `globalThis` and wrapped by `WasmBridge` in JS.

| Function | Returns | Description |
|---|---|---|
| `parseSession(provider, rawJSON)` | `{ok, data}` | Parse scraped messages into Session JSON |
| `summarizeSession(sessionJSON)` | `{ok, data}` | Local 3-tier compression |
| `buildInjectPrompt(input, provider, maxChars?)` | `{ok, data}` | Format provider-specific inject prompt |
| `serializeSession(sessionJSON)` | `{ok, data}` | Validate + canonical JSON |
| `deserializeSession(sessionJSON)` | `{ok, data}` | Parse + validate |
| `generateSessionID()` | `{ok, data}` | UUID v4 |
| `searchSessions(sessionsJSON, keyword)` | `{ok, data}` | Filter by keyword |
| `callAIAPI(apiKey, model, prompt)` | `Promise<{ok, data}>` | Call OpenAI or Anthropic |

## Data Model

```
Session {
  id        string
  provider  "chatgpt" | "claude" | "gemini"
  timestamp number (Unix ms)
  tags      string[]
  messages  Message[]
  summary   string
  title     string
}

Message {
  role      "user" | "assistant"
  content   string
  timestamp number (Unix ms)
}
```

Stored in `chrome.storage.local` under keys `portex_sessions` and `portex_settings`.

## Security

- **CSP** — `script-src 'self' 'wasm-unsafe-eval'` (required for WASM, no inline scripts)
- **API keys** — stored in `chrome.storage.local` (encrypted by Chrome), never in code or logs
- **Content scripts** — communicate only via `chrome.runtime.onMessage`, not `window.postMessage`
- **No dependencies** — zero external CDNs, analytics, or tracking
- **Input validation** — all data validated in Go before processing, provider names allowlisted

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run `cd wasm && make build` to verify Go compiles
5. Load the extension in Chrome and test manually
6. Open a pull request

### Build Order for New Contributors

1. Get `make build` working — verify WASM loads in browser console
2. Test `parseSession` with ChatGPT
3. Wire save → summarize → inject end-to-end
4. Add Claude/Gemini scraper support (see `scraper.js`)

## Roadmap

- [x] ChatGPT end-to-end (save, summarize, inject)
- [x] Claude end-to-end
- [ ] Gemini scraper support
- [ ] Session tagging and filtering
- [ ] Import sessions from JSON
- [ ] TinyGo build for smaller WASM binary

## License

MIT
