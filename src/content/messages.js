// Message stamper: shows the date and time above or below each message inside the open chat.
// Times come from the adapter's fetchMessageTimes and live only in memory.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const LABEL_CLASS = 'chatstamp-msg';
  const REFETCH_DELAY_MS = 4 * 1000;
  const MIN_REFETCH_INTERVAL_MS = 8 * 1000;
  // Per message count, so a message the server never dates doesn't cause endless refetching.
  const MAX_FETCHES_PER_COUNT = 3;

  ChatStamp.createMessageStamper = function (state) {
    const { adapter } = state;
    let chatId = null;
    let times = null; // { byId: Map, byRole: { user: [], assistant: [] } }
    let inFlight = false;
    let lastFetch = 0;
    let fetchedCount = -1;
    let fetchesForCount = 0;
    let retryTimer = null;
    let lastStatus = '';

    const supported = () => adapter.messageElements && adapter.fetchMessageTimes;
    const enabled = () =>
      state.settings.messageTimes !== false && state.settings.enabled[adapter.id] !== false;

    function removeAll() {
      document.querySelectorAll(`.${LABEL_CLASS}`).forEach((label) => label.remove());
    }

    function index(list) {
      const byId = new Map();
      const byRole = { user: [], assistant: [] };
      for (const item of list) {
        if (item.id) byId.set(item.id, item.t);
        if (byRole[item.role]) byRole[item.role].push(item.t);
      }
      return { byId, byRole };
    }

    async function load(messageCount) {
      const id = chatId;
      if (!id || inFlight) return;
      inFlight = true;
      lastFetch = Date.now();
      if (messageCount === fetchedCount) fetchesForCount++;
      else {
        fetchedCount = messageCount;
        fetchesForCount = 1;
      }
      ChatStamp.info(`fetching message times (attempt ${fetchesForCount} for ${messageCount} messages)`);
      try {
        const list = await adapter.fetchMessageTimes(id);
        if (id === chatId) times = index(list);
      } catch (err) {
        ChatStamp.info('message times request failed:', err && err.message ? err.message : err);
        // Leave an empty result so apply() retries through the throttled path, not on every mutation.
        if (id === chatId && !times) times = index([]);
      } finally {
        inFlight = false;
        state.render();
      }
    }

    // New or not-yet-saved messages have no time yet; fetch again shortly, throttled.
    function scheduleRefetch(messageCount) {
      if (retryTimer || inFlight) return;
      if (messageCount === fetchedCount && fetchesForCount >= MAX_FETCHES_PER_COUNT) return;
      const wait = Math.max(REFETCH_DELAY_MS, lastFetch + MIN_REFETCH_INTERVAL_MS - Date.now());
      retryTimer = setTimeout(() => {
        retryTimer = null;
        load(messageCount);
      }, wait);
    }

    function onRoute(id) {
      if (id === chatId) return;
      chatId = id;
      times = null;
      fetchedCount = -1;
      fetchesForCount = 0;
      lastStatus = '';
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    function labelFor(el, role) {
      let label = el.querySelector(`:scope > .${LABEL_CLASS}`);
      if (!label) {
        label = document.createElement('span');
        label.className = `${LABEL_CLASS} ${LABEL_CLASS}--${role}`;
        // Above each message by default; adapters can set messageLabelPosition: 'end' for below.
        if (adapter.messageLabelPosition === 'end') el.append(label);
        else el.prepend(label);
      }
      return label;
    }

    function apply() {
      if (!supported()) return;
      if (!enabled() || !chatId) {
        const why = !chatId ? `this page is not a chat (${location.pathname})` : 'message times are turned off';
        if (lastStatus !== why) {
          lastStatus = why;
          ChatStamp.info(why);
        }
        removeAll();
        return;
      }

      const items = adapter.messageElements();
      if (!items.length) {
        if (lastStatus !== 'none') {
          lastStatus = 'none';
          ChatStamp.info('no message elements found on this page');
        }
        return;
      }
      if (!times) {
        if (!inFlight) load(items.length);
        return;
      }

      const seen = { user: 0, assistant: 0 };
      let missing = 0;
      for (const { el, id, role } of items) {
        const position = seen[role]++;
        // Exact id match where the site provides one, else position within the role.
        const t = (id && times.byId.get(id)) || times.byRole[role][position];
        if (!t) {
          missing++;
          const stale = el.querySelector(`:scope > .${LABEL_CLASS}`);
          if (stale) stale.remove();
          continue;
        }
        const label = labelFor(el, role);
        const key = `${t}|${state.settings.clock}`;
        if (label.dataset.key === key) continue;
        label.dataset.key = key;
        label.textContent = ChatStamp.format.formatDateTime(t, state.settings.clock);
        label.title = `${ChatStamp.format.formatDate(t)}, ${ChatStamp.format.formatTimeSeconds(t, state.settings.clock)}`;
      }
      const status = `messages on page: ${items.length}, times fetched: ${times.byRole.user.length + times.byRole.assistant.length}, labelled: ${items.length - missing}`;
      if (status !== lastStatus) {
        lastStatus = status;
        ChatStamp.info(status);
      }
      if (missing) scheduleRefetch(items.length);
    }

    return { apply, onRoute, removeAll };
  };
})();
