// Content script entry point: picks the platform adapter (FR-1) and wires the
// collector, injector and navigation watcher together.
(function () {
  const ChatStamp = globalThis.ChatStamp;

  const RENDER_DEBOUNCE_MS = 150;
  const RELATIVE_REFRESH_MS = 60 * 1000;

  async function main() {
    const adapter = Object.values(ChatStamp.platforms).find((p) => p.hosts.includes(location.hostname));
    if (!adapter) return;

    const state = {
      adapter,
      settings: await ChatStamp.storage.getSettings(),
      records: new Map(),
    };
    for (const record of await ChatStamp.storage.getRecords(adapter.id)) state.records.set(record.id, record);

    const collector = ChatStamp.createCollector(state);
    const stamper = ChatStamp.createMessageStamper(state);
    let observer;
    let nav;
    let refreshTimer;

    // After the extension is reloaded or removed, this old script loses access
    // to chrome.* APIs; stop quietly instead of throwing on every mutation.
    function teardown() {
      if (observer) observer.disconnect();
      if (nav) nav.stop();
      clearInterval(refreshTimer);
      ChatStamp.injector.removeAll();
      stamper.removeAll();
    }

    state.render = ChatStamp.debounce(() => {
      if (!chrome.runtime?.id) return teardown();
      try {
        ChatStamp.injector.apply(state, collector);
      } catch (err) {
        ChatStamp.log('render failed', err);
      }
      try {
        stamper.apply();
      } catch (err) {
        ChatStamp.info('message render failed:', err);
      }
    }, RENDER_DEBOUNCE_MS);

    const onRoute = (url) => {
      const chatId = adapter.chatIdFromUrl(url);
      stamper.onRoute(chatId);
      collector.onRoute(chatId).then(state.render);
    };

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key === ChatStamp.storage.SETTINGS_KEY) {
          const wasEnabled = state.settings.enabled[adapter.id] !== false;
          state.settings = {
            ...ChatStamp.DEFAULT_SETTINGS,
            ...newValue,
            enabled: { ...ChatStamp.DEFAULT_SETTINGS.enabled, ...(newValue && newValue.enabled) },
          };
          if (!wasEnabled && state.settings.enabled[adapter.id] !== false) {
            onRoute(location.href);
            collector.sync().then(state.render);
          }
        } else if (ChatStamp.storage.isRecordKey(key)) {
          const [, platform, id] = key.split(':');
          if (platform !== adapter.id) continue;
          if (newValue) state.records.set(id, newValue);
          else state.records.delete(id);
        }
      }
      state.render();
    });

    observer = new MutationObserver(() => {
      state.render();
      if (nav) nav.check();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    nav = ChatStamp.watchNavigation(onRoute);
    refreshTimer = setInterval(state.render, RELATIVE_REFRESH_MS);

    onRoute(location.href);
    state.render();
    // FR-4 / NFR: fetch metadata once per page load; later refreshes are driven by navigation.
    collector.sync().then(state.render);
  }

  main().catch((err) => ChatStamp.info('startup failed:', err));
})();
