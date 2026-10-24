// Navigation watcher: detects single-page-app route changes (FR-6).
// Content scripts run in an isolated world and cannot patch the page's
// history.pushState, so we listen to the Navigation API where available and
// fall back to a cheap once-a-second URL comparison.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  ChatStamp.watchNavigation = function (onChange) {
    let last = location.href;
    const check = () => {
      if (location.href === last) return;
      last = location.href;
      onChange(location.href);
    };

    if (window.navigation) window.navigation.addEventListener('currententrychange', check);
    window.addEventListener('popstate', check);
    const timer = setInterval(check, 1000);

    return {
      check,
      stop() {
        if (window.navigation) window.navigation.removeEventListener('currententrychange', check);
        window.removeEventListener('popstate', check);
        clearInterval(timer);
      },
    };
  };
})();
