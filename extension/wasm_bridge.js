'use strict';

const WASM_PATH = chrome.runtime.getURL('portex.wasm');

let _initPromise = null;

async function initWasm() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (typeof Go === 'undefined') {
      throw new Error('Go runtime not found — wasm_exec.js must load before wasm_bridge.js');
    }

    const go = new Go();

    // Try streaming instantiation first (faster), fall back to buffered if MIME type is wrong
    let instance;
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        const result = await WebAssembly.instantiateStreaming(fetch(WASM_PATH), go.importObject);
        instance = result.instance;
      } catch {
        instance = null;
      }
    }

    if (!instance) {
      const buffer = await fetch(WASM_PATH).then((r) => r.arrayBuffer());
      const result = await WebAssembly.instantiate(buffer, go.importObject);
      instance = result.instance;
    }

    go.run(instance);
    await _waitForReady();
  })();

  return _initPromise;
}

function _waitForReady(timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (globalThis.wasmReady) return resolve();
      if (Date.now() > deadline) return reject(new Error('WASM init timed out'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

// Go functions return {ok: true, data: string} or {ok: false, error: string}.
// callAIAPI returns a Promise wrapping the same shape.
async function _call(fnName, ...args) {
  await initWasm();

  const fn = globalThis[fnName];
  if (typeof fn !== 'function') {
    throw new Error(`WASM function '${fnName}' is not registered`);
  }

  const envelope = await fn(...args);

  if (!envelope || typeof envelope !== 'object') {
    throw new Error(`WASM '${fnName}': unexpected return type`);
  }
  if (envelope.ok === false) {
    throw new Error(envelope.error || `WASM '${fnName}': unknown error`);
  }

  return envelope.data;
}

const WasmBridge = Object.freeze({
  init: initWasm,
  parseSession:       (provider, rawJSON) => _call('parseSession', provider, rawJSON),
  summarizeSession:   (sessionJSON) => _call('summarizeSession', sessionJSON),
  buildInjectPrompt:  (input, provider, maxChars) => _call('buildInjectPrompt', input, provider, maxChars ?? null),
  serializeSession:   (sessionJSON) => _call('serializeSession', sessionJSON),
  deserializeSession: (sessionJSON) => _call('deserializeSession', sessionJSON),
  generateSessionID:  () => _call('generateSessionID'),
  searchSessions:     (sessionsJSON, keyword) => _call('searchSessions', sessionsJSON, keyword),
  callAIAPI:          (apiKey, model, prompt) => _call('callAIAPI', apiKey, model, prompt),
  addTag:             (sessionJSON, tag) => _call('addTag', sessionJSON, tag),
  removeTag:          (sessionJSON, tag) => _call('removeTag', sessionJSON, tag),
});
