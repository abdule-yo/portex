'use strict';

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== 'inject-to-tab') return false;

  const { target, providerUrl, text } = request;

  (async () => {
    try {
      const matchUrl = providerUrl + '*';
      let [targetTab] = await chrome.tabs.query({ url: matchUrl });

      if (!targetTab) {
        targetTab = await chrome.tabs.create({ url: providerUrl });
        await waitForTabLoad(targetTab.id);
        await delay(2000); // extra wait for SPA to render
      } else {
        await chrome.tabs.update(targetTab.id, { active: true });
        await delay(500);
      }

      let response;
      try {
        response = await chrome.tabs.sendMessage(targetTab.id, { action: 'inject', text });
      } catch {
        // Content script not running yet — inject it, then retry
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['injector.js'],
        });
        await delay(300);
        response = await chrome.tabs.sendMessage(targetTab.id, { action: 'inject', text });
      }

      if (!response?.ok) {
        sendResponse({ ok: false, error: response?.error ?? 'Inject failed.' });
      } else {
        sendResponse({ ok: true, target });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});

function waitForTabLoad(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Tab load timeout')), timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(deadline);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
