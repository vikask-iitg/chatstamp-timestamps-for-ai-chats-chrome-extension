// Opens the one-screen welcome page after a fresh install.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/welcome.html') });
  }
  // Gemini support was removed in 0.3.0; drop any dates stored for it.
  if (reason === chrome.runtime.OnInstalledReason.UPDATE) {
    chrome.storage.local.get(null).then((all) => {
      const stale = Object.keys(all).filter((key) => key.startsWith('c:gemini:'));
      if (stale.length) chrome.storage.local.remove(stale);
    });
  }
});

// The PDF button on a chat page can't open extension pages itself, so it asks here.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'chatstamp:open-print') return;
  if (!['chatgpt', 'claude'].includes(message.p) || typeof message.id !== 'string' || !message.id) return;
  const query = new URLSearchParams({ p: message.p, id: message.id, t: String(message.t || '') });
  const url = chrome.runtime.getURL(`src/pages/print.html?${query}`);
  const tab = sender.tab;
  chrome.tabs.create(tab ? { url, index: tab.index + 1, windowId: tab.windowId } : { url });
});
