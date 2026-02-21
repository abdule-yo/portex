(() => {
  'use strict';

  const INPUT_SELECTORS = {
    chatgpt: '#prompt-textarea',
    // Claude uses a ProseMirror contenteditable — try the most specific first, fall through to broad
    claude:  '[contenteditable="true"].ProseMirror, div[contenteditable="true"][data-placeholder], div[contenteditable="true"]',
    gemini:  '.ql-editor[contenteditable="true"]',
  };

  const PROVIDER_MAP = {
    'chat.openai.com': 'chatgpt',
    'chatgpt.com':     'chatgpt',
    'claude.ai':       'claude',
    'gemini.google.com': 'gemini',
  };

  function detectProvider() {
    return PROVIDER_MAP[location.hostname] ?? null;
  }

  async function findInput(maxWaitMs = 3000) {
    const provider = detectProvider();
    if (!provider) throw new Error(`Unsupported provider: ${location.hostname}`);

    const selector = INPUT_SELECTORS[provider];
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const el = document.querySelector(selector);
      if (el) return el;
      await delay(100);
    }

    throw new Error(`Input box not found for ${provider}. Selector: "${selector}"`);
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // React and similar frameworks intercept native DOM setters, so we must use the
  // prototype setter and dispatch synthetic events to trigger framework re-renders.
  async function injectText(text) {
    const input = await findInput();
    input.focus();

    const tag = input.tagName.toUpperCase();

    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      const proto =
        tag === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(input, text);
      } else {
        input.value = text;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable (Claude/ProseMirror, Gemini/Quill)
      // Focus and select all existing content, then replace via execCommand
      // so the editor's own paragraph model handles newlines correctly.
      input.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');
      await delay(30);

      // Insert line-by-line so ProseMirror/Quill create real paragraph nodes
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        document.execCommand('insertText', false, lines[i]);
        if (i < lines.length - 1) {
          // Blank lines become paragraph breaks; non-blank become soft breaks
          if (lines[i] === '' && lines[i + 1] === '') continue; // skip double-blank
          document.execCommand('insertParagraph');
        }
      }

      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(input);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== 'inject') return false;

    if (typeof request.text !== 'string' || request.text.trim() === '') {
      sendResponse({ ok: false, error: 'inject: text is empty or invalid' });
      return true;
    }

    injectText(request.text)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    return true;
  });
})();
