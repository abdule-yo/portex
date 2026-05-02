(() => {
  'use strict';

  const PROVIDER_MAP = {
    'chat.openai.com': 'chatgpt',
    'chatgpt.com': 'chatgpt',
    'claude.ai': 'claude',
    'gemini.google.com': 'gemini',
  };

  function detectProvider() {
    return PROVIDER_MAP[location.hostname] ?? null;
  }

  // Scroll top → bottom → top to force lazy-loaded messages to render
  async function scrollAndWait() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await delay(800);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await delay(400);
    window.scrollTo({ top: 0 });
    await delay(200);
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ChatGPT: turns use [data-message-author-role], content in .markdown or [class*="prose"]
  function scrapeChatGPT() {
    const turns = document.querySelectorAll('[data-message-author-role]');
    const messages = [];

    for (const turn of turns) {
      const role = turn.getAttribute('data-message-author-role') ?? 'assistant';
      const contentEl = turn.querySelector('.markdown, [class*="prose"]') ?? turn;
      const content = contentEl.innerText.trim();
      if (content) messages.push({ role, content });
    }

    return messages;
  }

  // Claude: turns tagged with data-testid="human-turn" / "ai-turn"
  function scrapeClaude() {
    const turns = document.querySelectorAll(
      '[data-testid="human-turn"], [data-testid="ai-turn"]',
    );
    const messages = [];

    for (const turn of turns) {
      const isUser = turn.getAttribute('data-testid') === 'human-turn';
      const content = turn.innerText.trim();
      if (content) messages.push({ role: isUser ? 'user' : 'assistant', content });
    }

    return messages;
  }

  // Gemini uses Angular custom elements confirmed via live DOM inspection:
  //   User turns:  <user-query>  → text inside <user-query-content>
  //   Model turns: <model-response> → text inside <message-content>
  //
  // The outer elements include "You said" / "Gemini said" aria labels in
  // their innerText, so we must target the inner content elements directly.
  function scrapeGemini() {
    const structured = scrapeGeminiStructured();
    if (structured.length > 0) return structured;

    // Fallback: class-name heuristics in case Gemini updates its custom elements
    const heuristic = scrapeGeminiHeuristic();
    if (heuristic.length > 0) return heuristic;

    throw new Error(
      'Could not find Gemini messages. ' +
      'Make sure you are on a Gemini conversation page (not the home screen).',
    );
  }

  function scrapeGeminiStructured() {
    const messages = [];

    // Query both custom element types in a single pass, then sort by DOM order
    const allTurns = Array.from(
      document.querySelectorAll('user-query, model-response'),
    ).sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));

    for (const turn of allTurns) {
      const isUser = turn.tagName.toLowerCase() === 'user-query';

      let contentEl;
      if (isUser) {
        // Confirmed DOM structure (Angular):
        //   <user-query>
        //     <span class="cdk-visually-hidden ...">You said</span>  ← screen-reader only
        //     <user-query-content>
        //       <div class="query-content ...">
        //         <p class="query-text-line ...">actual user text</p>
        //       </div>
        //     </user-query-content>
        //
        // Target p.query-text-line directly to skip the hidden aria label.
        const queryContent = turn.querySelector('div.query-content');
        const textLine = turn.querySelector('p.query-text-line');

        if (textLine) {
          contentEl = textLine;
        } else if (queryContent) {
          contentEl = queryContent;
        } else {
          // Last resort: grab innerText but strip the visually-hidden span text
          contentEl = null;
          const hidden = turn.querySelector('.cdk-visually-hidden');
          const hiddenText = hidden?.innerText?.trim() ?? '';
          const raw = turn.innerText.trim();
          const content = hiddenText && raw.startsWith(hiddenText)
            ? raw.slice(hiddenText.length).trim()
            : raw;
          if (content) messages.push({ role: 'user', content });
          continue;
        }
      } else {
        // <message-content> holds the response markdown without the
        // "Gemini said" aria prefix on <model-response>
        contentEl =
          turn.querySelector('message-content, .response-content, .markdown') ??
          turn;
      }

      const content = contentEl.innerText.trim();
      if (content) {
        messages.push({ role: isUser ? 'user' : 'assistant', content });
      }
    }

    return messages;
  }

  function scrapeGeminiHeuristic() {
    // Emergency fallback: scan for class-name fragments if custom elements vanish
    const messages = [];
    const candidates = document.querySelectorAll(
      '[class*="user-query"], [class*="model-response"], [class*="message-content"]',
    );

    for (const el of candidates) {
      const text = el.innerText?.trim() ?? '';
      if (text.length < 3) continue;

      // Skip nested matches (avoid double-counting child containers)
      const parentMatched = el.parentElement?.closest(
        '[class*="user-query"], [class*="model-response"], [class*="message-content"]',
      );
      if (parentMatched) continue;

      const cls = (el.getAttribute('class') ?? '').toLowerCase();
      const isUser = cls.includes('user-query');
      messages.push({ role: isUser ? 'user' : 'assistant', content: text });
    }

    return messages;
  }


  function scrapeMessages() {
    const provider = detectProvider();

    switch (provider) {
      case 'chatgpt': return scrapeChatGPT();
      case 'claude':  return scrapeClaude();
      case 'gemini':  return scrapeGemini();
      default:
        throw new Error(`Unsupported page: ${location.hostname}`);
    }
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== 'scrape') return false;

    (async () => {
      try {
        await scrollAndWait();
        const messages = scrapeMessages();

        if (messages.length === 0) {
          sendResponse({ ok: false, error: 'No messages found on page.' });
          return;
        }

        sendResponse({ ok: true, messages, provider: detectProvider() });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true;
  });
})();
