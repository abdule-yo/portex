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

  function scrapeGemini() {
    throw new Error('Gemini scraping is not supported yet.');
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
