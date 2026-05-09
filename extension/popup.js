'use strict';

const STORAGE_SESSIONS_KEY = 'portex_sessions';
const STORAGE_SETTINGS_KEY = 'portex_settings';

const PROVIDER_URLS = {
  chatgpt: 'https://chat.openai.com/',
  claude:  'https://claude.ai/',
  gemini:  'https://gemini.google.com/',
};

const HOSTNAME_TO_PROVIDER = {
  'chat.openai.com': 'chatgpt',
  'chatgpt.com':     'chatgpt',
  'claude.ai':       'claude',
  'gemini.google.com': 'gemini',
};

let sessions      = [];
let selectedId    = null;
let settings      = { apiKey: '', model: 'gpt-4o-mini' };
let searchTimeout = null;

const $ = (id) => document.getElementById(id);

const dom = {
  statusDot:      $('status-dot'),
  statusLabel:    $('status-label'),
  sessionsList:   $('sessions-list'),
  sessionsEmpty:  $('sessions-empty'),
  searchInput:    $('search-input'),
  injectTarget:   $('inject-target'),
  btnSave:        $('btn-save'),
  btnSummarize:   $('btn-summarize'),
  btnInject:      $('btn-inject'),
  btnExport:      $('btn-export'),
  btnDelete:      $('btn-delete'),
  tabSessions:    $('tab-sessions'),
  tabSettings:    $('tab-settings'),
  sessionsView:   $('sessions-view'),
  settingsView:   $('settings-view'),
  apiKeyInput:    $('api-key-input'),
  modelSelect:    $('model-select'),
  btnSaveSettings:$('btn-save-settings'),
  toast:          $('toast'),
  tagRow:         $('tag-row'),
  tagInput:       $('tag-input'),
  btnAddTag:      $('btn-add-tag'),
  btnImport:      $('btn-import'),
  fileImport:     $('file-import'),
};

async function init() {
  setStatus('loading', 'Loading WASM…');

  try {
    await WasmBridge.init();
    setStatus('ready', 'Ready');
  } catch (err) {
    setStatus('error', 'WASM error');
    showToast('WASM failed to load: ' + err.message, 'error');
    return;
  }

  [sessions, settings] = await Promise.all([loadSessions(), loadSettings()]);

  dom.apiKeyInput.value = settings.apiKey ? '••••••••' : '';
  dom.modelSelect.value = settings.model;

  // Default inject target to the provider the user currently has open
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const hostname = new URL(tab.url).hostname;
      const provider = HOSTNAME_TO_PROVIDER[hostname];
      if (provider) dom.injectTarget.value = provider;
    }
  } catch {}

  renderSessions(sessions);
  bindEvents();
}

function setStatus(state, label) {
  dom.statusDot.className = state;
  dom.statusLabel.textContent = label;
}

let _toastTimer = null;
function showToast(message, type = 'info', ms = 2800) {
  dom.toast.textContent = message;
  dom.toast.className = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { dom.toast.className = ''; }, ms);
}

async function loadSessions() {
  const result = await chrome.storage.local.get(STORAGE_SESSIONS_KEY);
  return result[STORAGE_SESSIONS_KEY] ?? [];
}

async function saveSessions(list) {
  await chrome.storage.local.set({ [STORAGE_SESSIONS_KEY]: list });
}

async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  return { apiKey: '', model: 'gpt-4o-mini', ...(result[STORAGE_SETTINGS_KEY] ?? {}) };
}

async function saveSettings(s) {
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: s });
}

function renderSessions(list) {
  dom.sessionsList
    .querySelectorAll('.session-item')
    .forEach((el) => el.remove());

  if (list.length === 0) {
    dom.sessionsEmpty.hidden = false;
    return;
  }
  dom.sessionsEmpty.hidden = true;

  const frag = document.createDocumentFragment();
  for (const session of list) {
    frag.appendChild(buildSessionItem(session));
  }
  dom.sessionsList.appendChild(frag);

  if (selectedId) {
    const el = dom.sessionsList.querySelector(`[data-id="${selectedId}"]`);
    if (el) el.classList.add('selected');
    else selectSession(null);
  }
}

function buildSessionItem(session) {
  const item = document.createElement('div');
  item.className = 'session-item';
  item.dataset.id = session.id;

  const badge = document.createElement('span');
  badge.className = `session-provider-badge ${session.provider}`;
  badge.textContent = session.provider;

  const meta = document.createElement('div');
  meta.className = 'session-meta';

  const title = document.createElement('div');
  title.className = 'session-title';
  title.textContent = session.title || 'Untitled';
  if (session.summary) {
    const tag = document.createElement('span');
    tag.className = 'session-summary-tag';
    tag.textContent = '✓ summarized';
    title.appendChild(tag);
  }

  const sub = document.createElement('div');
  sub.className = 'session-subtitle';
  sub.textContent = `${session.messages?.length ?? 0} messages · ${formatDate(session.timestamp)}`;

  meta.appendChild(title);
  meta.appendChild(sub);

  // Tag chips
  if (session.tags?.length > 0) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'session-tags';
    for (const tag of session.tags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'tag-chip-remove';
      removeBtn.title = `Remove tag “${tag}”`;
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // don’t re-select the session
        handleRemoveTag(session.id, tag);
      });

      chip.appendChild(removeBtn);
      tagsEl.appendChild(chip);
    }
    meta.appendChild(tagsEl);
  }

  item.appendChild(badge);
  item.appendChild(meta);

  item.addEventListener('click', () => selectSession(session.id));
  return item;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function selectSession(id) {
  selectedId = id;

  dom.sessionsList.querySelectorAll('.session-item').forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === id);
  });

  const hasSelection = id !== null;
  dom.btnSummarize.disabled = !hasSelection;
  dom.btnExport.disabled    = !hasSelection;
  dom.btnDelete.disabled    = !hasSelection;
  dom.btnInject.disabled    = !hasSelection;
  dom.injectTarget.disabled = !hasSelection;

  // Show/hide the tag input row
  dom.tagRow.classList.toggle('visible', hasSelection);
  dom.tagInput.value = '';
}

async function handleSaveChat() {
  dom.btnSave.disabled = true;
  dom.btnSave.textContent = 'Scraping…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    } catch {
      throw new Error('Content script not ready. Reload the AI chat page and try again.');
    }

    if (!response?.ok) throw new Error(response?.error ?? 'Scraping failed.');
    if (!response.messages?.length) throw new Error('No messages found on this page.');

    const rawJSON    = JSON.stringify(response.messages);
    const sessionStr = await WasmBridge.parseSession(response.provider, rawJSON);
    const session    = JSON.parse(sessionStr);

    sessions.unshift(session);
    await saveSessions(sessions);
    renderSessions(sessions);
    selectSession(session.id);
    showToast(`Saved "${session.title}"`, 'success');
  } catch (err) {
    showToast(err.message, 'error', 4000);
  } finally {
    dom.btnSave.disabled    = false;
    dom.btnSave.textContent = 'Save Current Chat';
  }
}

async function handleSummarize() {
  if (!selectedId) return;
  const session = sessions.find((s) => s.id === selectedId);
  if (!session) return;

  dom.btnSummarize.disabled    = true;
  dom.btnSummarize.textContent = 'Summarizing…';

  try {
    let summary;

    if (settings.apiKey) {
      const prompt = buildSummarizePromptText(session);
      summary = await WasmBridge.callAIAPI(settings.apiKey, settings.model, prompt);
    } else {
      summary = await WasmBridge.summarizeSession(JSON.stringify(session));
    }

    session.summary = summary;
    sessions = sessions.map((s) => (s.id === selectedId ? session : s));
    await saveSessions(sessions);
    renderSessions(sessions);
    selectSession(selectedId);
    showToast('Summary saved', 'success');
  } catch (err) {
    showToast('Summarize failed: ' + err.message, 'error', 4000);
  } finally {
    dom.btnSummarize.disabled    = false;
    dom.btnSummarize.textContent = 'Summarize';
  }
}

function buildSummarizePromptText(session) {
  const lines = [
    'Summarize the following conversation concisely.',
    'Preserve key decisions, code, and important facts.',
    'Output plain text, no markdown headers.\n',
  ];
  for (const m of session.messages) {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${role}: ${m.content}`);
  }
  return lines.join('\n');
}

async function handleInject() {
  if (!selectedId) return;
  const session = sessions.find((s) => s.id === selectedId);
  if (!session) return;

  const target = dom.injectTarget.value;

  dom.btnInject.disabled    = true;
  dom.btnInject.textContent = 'Injecting…';

  try {
    const prompt = await WasmBridge.buildInjectPrompt(JSON.stringify(session), target);

    // Delegate to background service worker — the popup will close when
    // the tab switches, but the service worker keeps running.
    chrome.runtime.sendMessage({
      action: 'inject-to-tab',
      target,
      providerUrl: PROVIDER_URLS[target],
      text: prompt,
    });

    // The popup will close once the tab switches, so show toast briefly
    showToast(`Injecting into ${target}…`, 'success');
  } catch (err) {
    showToast('Inject failed: ' + err.message, 'error', 4000);
    dom.btnInject.disabled    = false;
    dom.btnInject.textContent = 'Inject';
  }
}

async function handleExport() {
  if (!selectedId) return;
  const session = sessions.find((s) => s.id === selectedId);
  if (!session) return;

  try {
    const json = JSON.stringify(session, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `portex-${session.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported', 'success');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}

async function handleDelete() {
  if (!selectedId) return;
  sessions = sessions.filter((s) => s.id !== selectedId);
  await saveSessions(sessions);
  selectSession(null);
  renderSessions(sessions);
  showToast('Session deleted');
}

async function handleAddTag() {
  if (!selectedId) return;
  const tag = dom.tagInput.value.trim();
  if (!tag) return;

  const session = sessions.find((s) => s.id === selectedId);
  if (!session) return;

  try {
    const updatedJSON = await WasmBridge.addTag(JSON.stringify(session), tag);
    const updated = JSON.parse(updatedJSON);
    sessions = sessions.map((s) => (s.id === selectedId ? updated : s));
    await saveSessions(sessions);
    dom.tagInput.value = '';
    renderSessions(sessions);
    selectSession(selectedId);
  } catch (err) {
    showToast('Add tag failed: ' + err.message, 'error');
  }
}

async function handleRemoveTag(sessionId, tag) {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  try {
    const updatedJSON = await WasmBridge.removeTag(JSON.stringify(session), tag);
    const updated = JSON.parse(updatedJSON);
    sessions = sessions.map((s) => (s.id === sessionId ? updated : s));
    await saveSessions(sessions);
    renderSessions(sessions);
    selectSession(selectedId);
  } catch (err) {
    showToast('Remove tag failed: ' + err.message, 'error');
  }
}

async function handleImport() {
  dom.fileImport.click();
}

async function handleFileSelected(file) {
  if (!file) return;

  let raw;
  try {
    raw = await file.text();
  } catch {
    showToast('Could not read file', 'error');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    showToast('Invalid JSON file', 'error', 4000);
    return;
  }

  // Accept a single session object or an array of sessions
  const candidates = Array.isArray(parsed) ? parsed : [parsed];

  const existingIds = new Set(sessions.map((s) => s.id));
  const imported = [];
  const errors   = [];

  for (const candidate of candidates) {
    try {
      const validatedJSON = await WasmBridge.deserializeSession(JSON.stringify(candidate));
      const session = JSON.parse(validatedJSON);
      if (existingIds.has(session.id)) {
        errors.push(`Duplicate: ${session.title || session.id}`);
        continue;
      }
      imported.push(session);
      existingIds.add(session.id);
    } catch (err) {
      errors.push(`Skipped: ${err.message}`);
    }
  }

  if (imported.length === 0) {
    showToast(errors[0] ?? 'No valid sessions found', 'error', 4000);
    return;
  }

  // Prepend newest first
  sessions = [...imported.reverse(), ...sessions];
  await saveSessions(sessions);
  renderSessions(sessions);

  const msg = imported.length === 1
    ? `Imported “${imported[0].title || 'session'}”`
    : `Imported ${imported.length} sessions`;
  showToast(msg + (errors.length ? ` (⚠️ ${errors.length} skipped)` : ''), 'success', 3500);

  // Reset file input so the same file can be re-picked if needed
  dom.fileImport.value = '';
}

async function handleSaveSettings() {
  const rawKey = dom.apiKeyInput.value.trim();
  // Only update if it's not the masked placeholder dots
  const isPlaceholder = /^•+$/.test(rawKey);
  if (!isPlaceholder) {
    settings.apiKey = rawKey;
  }
  settings.model = dom.modelSelect.value;

  await saveSettings(settings);
  showToast('Settings saved', 'success');
}

async function handleSearch(keyword) {
  if (!keyword.trim()) {
    renderSessions(sessions);
    return;
  }
  try {
    const resultJSON = await WasmBridge.searchSessions(JSON.stringify(sessions), keyword);
    renderSessions(JSON.parse(resultJSON));
  } catch {
    renderSessions(sessions);
  }
}

function switchTab(viewId) {
  [dom.sessionsView, dom.settingsView].forEach((v) => { v.hidden = v.id !== viewId; });
  [dom.tabSessions, dom.tabSettings].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
}

function bindEvents() {
  dom.btnSave.addEventListener('click', handleSaveChat);
  dom.btnSummarize.addEventListener('click', handleSummarize);
  dom.btnInject.addEventListener('click', handleInject);
  dom.btnExport.addEventListener('click', handleExport);
  dom.btnDelete.addEventListener('click', handleDelete);
  dom.btnSaveSettings.addEventListener('click', handleSaveSettings);
  dom.btnImport.addEventListener('click', handleImport);
  dom.fileImport.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));

  dom.btnAddTag.addEventListener('click', handleAddTag);
  dom.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); }
  });

  dom.tabSessions.addEventListener('click', () => switchTab('sessions-view'));
  dom.tabSettings.addEventListener('click', () => switchTab('settings-view'));

  dom.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleSearch(e.target.value), 250);
  });

  dom.apiKeyInput.addEventListener('focus', () => {
    if (/^•+$/.test(dom.apiKeyInput.value)) dom.apiKeyInput.value = '';
  });
}

document.addEventListener('DOMContentLoaded', init);
