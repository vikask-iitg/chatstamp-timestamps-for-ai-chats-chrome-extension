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

  async function loadBranch(chatId) {
    const token = await getAccessToken();
    const res = await fetch(`/backend-api/conversation/${encodeURIComponent(chatId)}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
      signal: ChatStamp.timeoutSignal(),
    });
    if (!res.ok) throw new Error(`conversation ${res.status}`);
    const data = await res.json();
    return ChatStamp.walkBranch(data.mapping || {}, data.current_node, (node) => node.parent);
  }

  // The readable text and image references of a message. Tool calls, hidden context and
  // model reasoning have neither here, so those messages come back empty and are skipped.
  function messageParts(message) {
    const content = message.content || {};
    if (content.content_type === 'code') return { text: `\`\`\`\n${content.text || ''}\n\`\`\``, pointers: [] };
    if (content.content_type !== 'text' && content.content_type !== 'multimodal_text') return { text: '', pointers: [] };
    const parts = content.parts || [];
    return {
      text: parts.filter((part) => typeof part === 'string' && part).join('\n\n'),
      pointers: parts.filter((part) => part && part.content_type === 'image_asset_pointer').map((part) => part.asset_pointer),
    };
  }

  // Uploaded and generated images use different file addresses; both give a temporary link.
  async function loadPointer(pointer, chatId) {
    const fileId = String(pointer || '').replace(/^[\w-]+:\/\//, '');
    if (!fileId) return null;
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    const id = encodeURIComponent(fileId);
    for (const path of [
      `/backend-api/files/download/${id}?conversation_id=${encodeURIComponent(chatId)}&inline=false`,
      `/backend-api/files/${id}/download`,
    ]) {
      try {
        const res = await fetch(path, { credentials: 'include', headers, signal: ChatStamp.timeoutSignal() });
        if (!res.ok) {
          ChatStamp.info(`image link refused (${res.status}): ${path.split('?')[0]}`);
          continue;
        }
        const { download_url: url } = await res.json();
        if (!url) {
          ChatStamp.info(`image link missing in reply: ${path.split('?')[0]}`);
          continue;
        }
        // Only our own site gets the login token, never a file host.
        const sameSite = new URL(url, location.origin).origin === location.origin;
        const image = await ChatStamp.loadImage(url, sameSite ? headers : undefined);
        if (image) return image;
        ChatStamp.info('image file could not be read');
      } catch (err) {
        ChatStamp.info('image link failed:', err && err.message);
      }
    }
    return null;
  }

  ChatStamp.platforms.chatgpt = {
    id: 'chatgpt',
    hosts: ['chatgpt.com'],
    // Tried in order; the first selector that matches anything is used.
    linkSelectors: ['nav a[href*="/c/"]', 'a[href*="/c/"]'],
    titleSelector: '.truncate, [dir="auto"]',
    // Push the label to the right edge of the row, like Claude's sidebar.
    alignLabelEnd: true,
    shareButtonSelectors: ['[data-testid="share-chat-button"]'],

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
      const times = [];
      for (const { message } of await loadBranch(chatId)) {
        const role = message && message.author && message.author.role;
        const t = message && ChatStamp.toMillis(message.create_time);
        if (SHOWN_ROLES.has(role) && t) times.push({ id: message.id, role, t });
      }
      return times;
    },

    // The visible messages of the branch currently shown, for the print page.
    async fetchConversation(chatId) {
      const messages = [];
      let budget = ChatStamp.MAX_IMAGES_PER_CHAT;
      for (const { message } of await loadBranch(chatId)) {
        const author = message && message.author && message.author.role;
        if (!message || (!SHOWN_ROLES.has(author) && author !== 'tool')) continue;
        if (message.metadata && message.metadata.is_visually_hidden_from_conversation) continue;
        if (author === 'assistant' && message.recipient && message.recipient !== 'all') continue;
        const { text, pointers } = messageParts(message);
        // Tool messages only count for the images they produced, like generated pictures.
        const body = author === 'tool' ? '' : text;
        const images = [];
        let missing = 0;
        for (const pointer of pointers) {
          const image = budget > 0 ? await loadPointer(pointer, chatId) : null;
          if (image) {
            images.push(image);
            budget--;
          } else {
            missing++;
          }
        }
        const notes = Array(missing).fill('*[Image]*');
        const full = [body, ...notes].filter(Boolean).join('\n\n');
        if (!full.trim() && !images.length) continue;
        const entry = { role: author === 'tool' ? 'assistant' : author, t: ChatStamp.toMillis(message.create_time), text: full };
        if (images.length) entry.images = images;
        messages.push(entry);
      }
      return messages;
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
