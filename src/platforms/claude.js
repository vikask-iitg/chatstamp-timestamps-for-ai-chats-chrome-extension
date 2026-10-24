// Claude adapter. All selectors and endpoints for claude.ai live here.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const ID_PATTERN = /\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  async function getJson(path) {
    const res = await fetch(path, { credentials: 'include', signal: ChatStamp.timeoutSignal() });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  // Ids of chat-enabled organizations, or all of them if none say so. Cached for the page's lifetime.
  let orgIdsPromise = null;
  function getOrgIds() {
    if (!orgIdsPromise) {
      orgIdsPromise = getJson('/api/organizations').then((orgs) => {
        if (!Array.isArray(orgs) || !orgs.length) throw new Error('no organizations');
        const hasChat = (o) => Array.isArray(o.capabilities) && o.capabilities.includes('chat');
        const chatOrgs = orgs.filter(hasChat);
        return (chatOrgs.length ? chatOrgs : orgs).map((o) => o.uuid);
      });
      orgIdsPromise.catch(() => (orgIdsPromise = null));
    }
    return orgIdsPromise;
  }

  const USER_MESSAGE = '[data-testid="user-message"]';
  // Tried in order; the first selector that matches anything is used.
  const ASSISTANT_MESSAGES = ['[data-is-streaming]', '.font-claude-response'];

  ChatStamp.platforms.claude = {
    id: 'claude',
    hosts: ['claude.ai'],
    linkSelectors: ['nav a[href*="/chat/"]', 'a[href*="/chat/"]'],
    titleSelector: '.truncate',

    chatIdFromUrl(url) {
      const match = new URL(url, location.origin).pathname.match(ID_PATTERN);
      return match ? match[1].toLowerCase() : null;
    },

    // Message elements in page order. Claude's markup has no message ids, so
    // they are matched to times by position within each role.
    messageElements() {
      const assistant =
        ASSISTANT_MESSAGES.find((sel) => document.querySelector(sel)) || ASSISTANT_MESSAGES[0];
      const combined = `${USER_MESSAGE}, ${assistant}`;
      return Array.from(document.querySelectorAll(combined))
        .filter((el) => !el.parentElement.closest(combined))
        .map((el) => ({ el, id: null, role: el.matches(USER_MESSAGE) ? 'user' : 'assistant' }));
    },

    // Creation time of each message on the branch currently shown. Message text is not kept.
    async fetchMessageTimes(chatId) {
      let data;
      for (const org of await getOrgIds()) {
        try {
          data = await getJson(
            `/api/organizations/${org}/chat_conversations/${encodeURIComponent(chatId)}?tree=True&rendering_mode=messages`
          );
          break;
        } catch (err) {
          ChatStamp.log('claude chat not in org', org, err);
        }
      }
      if (!data) throw new Error('chat not found');

      const messages = Array.isArray(data.chat_messages) ? data.chat_messages : [];
      const byId = Object.fromEntries(messages.map((m) => [m.uuid, m]));
      const branch = data.current_leaf_message_uuid
        ? ChatStamp.walkBranch(byId, data.current_leaf_message_uuid, (m) => m.parent_message_uuid)
        : [...messages].sort((a, b) => a.index - b.index);
      const times = [];
      for (const m of branch) {
        const t = ChatStamp.toMillis(m.created_at);
        if (t) times.push({ id: null, role: m.sender === 'human' ? 'user' : 'assistant', t });
      }
      return times;
    },

    // Reads the same conversation list the app loads for its own sidebar.
    async fetchMetadata() {
      const results = [];
      for (const org of await getOrgIds()) {
        let list;
        try {
          list = await getJson(`/api/organizations/${org}/chat_conversations`);
        } catch (err) {
          ChatStamp.log('claude org skipped', org, err);
          continue;
        }
        for (const item of Array.isArray(list) ? list : []) {
          const c = ChatStamp.toMillis(item.created_at);
          if (!item.uuid || !c) continue;
          results.push({
            id: item.uuid.toLowerCase(),
            t: item.name || undefined,
            c,
            u: ChatStamp.toMillis(item.updated_at),
          });
        }
      }
      return results;
    },
  };
})();
