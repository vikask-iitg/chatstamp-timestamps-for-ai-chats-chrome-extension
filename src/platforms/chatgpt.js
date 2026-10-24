// ChatGPT adapter. All selectors and endpoints for chatgpt.com live here.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const ID_PATTERN = /\/c\/([a-zA-Z0-9-]+)/;
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const PAGE_DELAY_MS = 300;

  const TOKEN_TTL_MS = 5 * 60 * 1000;
  let tokenCache = null;

  async function getAccessToken() {
    if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.token;
    const res = await fetch('/api/auth/session', { credentials: 'include', signal: ChatStamp.timeoutSignal() });
    if (!res.ok) throw new Error(`session ${res.status}`);
    const session = await res.json();
    if (!session.accessToken) throw new Error('no access token');
    tokenCache = { token: session.accessToken, at: Date.now() };
    return session.accessToken;
  }

  const MESSAGE_SELECTOR = '[data-message-id][data-message-author-role]';
  const SHOWN_ROLES = new Set(['user', 'assistant']);

  ChatStamp.platforms.chatgpt = {
    id: 'chatgpt',
    hosts: ['chatgpt.com'],
    // Tried in order; the first selector that matches anything is used.
    linkSelectors: ['nav a[href*="/c/"]', 'a[href*="/c/"]'],
    titleSelector: '.truncate, [dir="auto"]',
    // Push the label to the right edge of the row, like Claude's sidebar.
    alignLabelEnd: true,

    chatIdFromUrl(url) {
      const match = new URL(url, location.origin).pathname.match(ID_PATTERN);
      return match ? match[1] : null;
    },

    // Message elements in page order. Each carries the message id, so times match exactly.
    messageElements() {
      return Array.from(document.querySelectorAll(MESSAGE_SELECTOR), (el) => ({
        el,
        id: el.getAttribute('data-message-id'),
        role: el.getAttribute('data-message-author-role'),
      })).filter((m) => SHOWN_ROLES.has(m.role));
    },

    // Creation time of each message on the branch currently shown, from the
    // same endpoint the app uses to load the chat. Message text is not kept.
    async fetchMessageTimes(chatId) {
      const token = await getAccessToken();
      const res = await fetch(`/backend-api/conversation/${encodeURIComponent(chatId)}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
        signal: ChatStamp.timeoutSignal(),
      });
      if (!res.ok) throw new Error(`conversation ${res.status}`);
      const data = await res.json();
      const branch = ChatStamp.walkBranch(data.mapping || {}, data.current_node, (node) => node.parent);
      const times = [];
      for (const { message } of branch) {
        const role = message && message.author && message.author.role;
        const t = message && ChatStamp.toMillis(message.create_time);
        if (SHOWN_ROLES.has(role) && t) times.push({ id: message.id, role, t });
      }
      return times;
    },

    // Reads the same conversation list the app loads for its own sidebar.
    // The list is ordered by last update, so on later loads we stop at the first
    // page that holds nothing new.
    async fetchMetadata(known) {
      const token = await getAccessToken();
      const results = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const offset = page * PAGE_SIZE;
        const res = await fetch(
          `/backend-api/conversations?offset=${offset}&limit=${PAGE_SIZE}&order=updated`,
          { credentials: 'include', headers: { Authorization: `Bearer ${token}` }, signal: ChatStamp.timeoutSignal() }
        );
        if (!res.ok) throw new Error(`conversations ${res.status}`);
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];

        let pageHasNews = false;
        for (const item of items) {
          const record = {
            id: item.id,
            t: item.title || undefined,
            c: ChatStamp.toMillis(item.create_time),
            u: ChatStamp.toMillis(item.update_time),
          };
          if (!record.id || !record.c) continue;
          const prev = known.get(record.id);
          if (!prev || prev.c !== record.c || (record.u && record.u !== prev.u) || prev.t !== record.t) {
            pageHasNews = true;
          }
          results.push(record);
        }

        const total = typeof data.total === 'number' ? data.total : Infinity;
        if (items.length < PAGE_SIZE || offset + items.length >= total || !pageHasNews) break;
        await ChatStamp.sleep(PAGE_DELAY_MS);
      }
      return results;
    },
  };
})();
