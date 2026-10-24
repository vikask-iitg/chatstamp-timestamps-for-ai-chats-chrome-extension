// Collector: records first-seen times and pulls real creation times from the
// platform adapter. Every failure is swallowed so the host page keeps working.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const MIN_SYNC_INTERVAL_MS = 15 * 1000;
  const NEW_CHAT_SYNC_DELAY_MS = 3 * 1000;

  ChatStamp.createCollector = function (state) {
    const { adapter } = state;
    let lastSync = 0;
    let inFlight = null;

    const enabled = () => state.settings.enabled[adapter.id] !== false;

    function remember(changed) {
      for (const record of changed) state.records.set(record.id, record);
      return changed;
    }

    // FR-3: first time this chat is opened or created.
    async function markSeen(id) {
      if (!enabled() || !id || state.records.has(id)) return;
      try {
        remember(await ChatStamp.storage.mergeRecords([{ p: adapter.id, id, f: Date.now() }]));
      } catch (err) {
        ChatStamp.log('markSeen failed', err);
      }
    }

    // Fill in titles for chats we know about but whose platform gave us no title.
    async function rememberTitles(titles) {
      if (!enabled() || !titles.length) return;
      try {
        remember(await ChatStamp.storage.mergeRecords(titles.map(({ id, t }) => ({ p: adapter.id, id, t }))));
      } catch (err) {
        ChatStamp.log('rememberTitles failed', err);
      }
    }

    // FR-4: real creation times from the app's own conversation list.
    function sync() {
      if (!enabled() || !adapter.fetchMetadata) return Promise.resolve();
      if (inFlight) return inFlight;
      lastSync = Date.now();
      inFlight = (async () => {
        try {
          const items = await adapter.fetchMetadata(state.records);
          const changed = await ChatStamp.storage.mergeRecords(items.map((item) => ({ ...item, p: adapter.id })));
          remember(changed);
          ChatStamp.log(`synced ${items.length} chats, ${changed.length} changed`);
        } catch (err) {
          // Undocumented endpoint changed or failed: first-seen dates still apply.
          ChatStamp.log('metadata sync failed', err);
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    }

    // Called on every route change. A chat with no real date yet is probably new,
    // so refresh the list (throttled) after giving the platform a moment to save it.
    async function onRoute(id) {
      await markSeen(id);
      const record = id && state.records.get(id);
      if (!record || record.c || !adapter.fetchMetadata) return;
      const wait = Math.max(NEW_CHAT_SYNC_DELAY_MS, lastSync + MIN_SYNC_INTERVAL_MS - Date.now());
      setTimeout(() => {
        const current = state.records.get(id);
        if (current && !current.c) sync().then(state.render);
      }, wait);
    }

    return { markSeen, rememberTitles, sync, onRoute };
  };
})();
