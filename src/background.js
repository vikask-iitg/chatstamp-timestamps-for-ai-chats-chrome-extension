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
