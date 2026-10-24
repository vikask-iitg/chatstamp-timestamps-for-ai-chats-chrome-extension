// Applies the saved light/dark theme before the page paints. chrome.storage is
// async, so the choice is mirrored in localStorage (shared by all extension pages)
// and settings.theme stays the source of truth.
(function () {
  const KEY = 'chatstamp-theme';
  let theme = 'light';
  try {
    if (localStorage.getItem(KEY) === 'dark') theme = 'dark';
  } catch {}
  document.documentElement.dataset.theme = theme;

  globalThis.ChatStampTheme = {
    set(next) {
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {}
    },
  };
})();
