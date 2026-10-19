import { createService } from './service.mjs';

const KEY = 'tab-garden-v1';
const service = createService({
  load: async () => (await chrome.storage.local.get(KEY))[KEY] ?? null,
  save: state => chrome.storage.local.set({ [KEY]: state }),
  tabs: async () => {
    const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return chrome.tabs.query({ windowId: window.id });
  },
  close: id => chrome.tabs.remove(id),
  group: async (ids, title) => {
    const groupId = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(groupId, { title, color: 'green', collapsed: false });
  },
  restore: urls => chrome.windows.create({ url: urls, focused: true }),
  open: url => chrome.tabs.create({ url, active: true }),
  focus: async id => { const tab = await chrome.tabs.update(id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); },
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // No content scripts, no external messages: only our own dashboard may call this service.
  if (sender.id !== chrome.runtime.id || sender.url?.split('?')[0] !== chrome.runtime.getURL('app/index.html')) return false;
  service(message).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app/index.html');
  const existing = (await chrome.tabs.query({ url })).find(tab => !tab.incognito);
  if (existing) { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
});
