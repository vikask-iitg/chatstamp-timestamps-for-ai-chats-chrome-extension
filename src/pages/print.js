// Print page: asks a tab on the chat's own site for the conversation, shows it as a
// clean document and opens the print dialog, where Chrome offers "Save as PDF".
// Message text lives only in this tab's memory and is never stored.
(function () {
  const ChatStamp = globalThis.ChatStamp;
  const $ = (id) => document.getElementById(id);
  const SITES = {
    chatgpt: { home: 'https://chatgpt.com/', match: 'https://chatgpt.com/*' },
    claude: { home: 'https://claude.ai/', match: 'https://claude.ai/*' },
  };
  const NEW_TAB_TIMEOUT_MS = 20 * 1000;
  const POLL_MS = 500;
  const IMAGE_WAIT_MS = 15 * 1000;

  const params = new URLSearchParams(location.search);
  const platform = params.get('p');
  const chatId = params.get('id');
  const chatTitle = params.get('t') || 'Untitled chat';
  const siteName = ChatStamp.PLATFORM_NAMES[platform];
  const request = { type: 'chatstamp:conversation', id: chatId };

  const ask = (tabId) => chrome.tabs.sendMessage(tabId, request);

  // Tabs opened before the extension was last reloaded can't answer; those just fail.
  async function askOpenTabs() {
    const tabs = await chrome.tabs.query({ url: SITES[platform].match, discarded: false });
    for (const tab of tabs) {
      try {
        const reply = await ask(tab.id);
        if (reply) return reply;
      } catch (err) {
        ChatStamp.log('tab did not answer', tab.id, err);
      }
    }
    return null;
  }

  async function askNewTab() {
    const tab = await chrome.tabs.create({ url: SITES[platform].home, active: false });
    try {
      const deadline = Date.now() + NEW_TAB_TIMEOUT_MS;
      while (Date.now() < deadline) {
        try {
          const reply = await ask(tab.id);
          if (reply) return reply;
        } catch {
          // The page's content script isn't ready yet.
        }
        await ChatStamp.sleep(POLL_MS);
      }
      return null;
    } finally {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  function showError(message) {
    $('state').textContent = message;
    $('retry').hidden = false;
    $('savePdf').hidden = true;
  }

  // Print only once images are ready, or they'd be blank in the PDF. A broken one becomes a note.
  async function imagesReady() {
    const images = [...document.querySelectorAll('.message-images img')];
    const settled = Promise.all(
      images.map((img) =>
        img.decode().catch(() => {
          const note = document.createElement('em');
          note.textContent = '[Image]';
          img.replaceWith(note);
        })
      )
    );
    await Promise.race([settled, ChatStamp.sleep(IMAGE_WAIT_MS)]);
  }

  function render(messages, settings) {
    const roleName = { user: 'You', assistant: siteName };
    const list = $('messages');
    list.replaceChildren();
    for (const message of messages) {
      const item = document.createElement('article');
      item.className = `message message--${message.role}`;
      const head = document.createElement('div');
      head.className = 'message-head';
      const who = document.createElement('strong');
      who.textContent = roleName[message.role];
      const when = document.createElement('span');
      when.textContent = message.t ? ChatStamp.format.formatDateTime(message.t, settings.clock) : '';
      head.append(who, when);
      const body = document.createElement('div');
      body.className = 'message-body';
      // markdownToHtml escapes all chat text before adding its own tags.
      const text = platform === 'chatgpt' && message.role === 'assistant' ? ChatStamp.stripChatUiTags(message.text) : message.text;
      body.innerHTML = ChatStamp.markdownToHtml(text);
      const images = (message.images || []).filter((src) => /^data:image\/|^https:/i.test(src));
      if (images.length) {
        const gallery = document.createElement('div');
        gallery.className = 'message-images';
        for (const src of images) {
          const img = document.createElement('img');
          img.alt = 'Image from this chat';
          img.src = src;
          gallery.append(img);
        }
        body.prepend(gallery);
      }
      item.append(head, body);
      list.append(item);
    }
    const count = `${messages.length} ${messages.length === 1 ? 'message' : 'messages'}`;
    $('title').textContent = chatTitle;
    $('meta').textContent = `${siteName} · ${count} · Exported ${ChatStamp.format.formatDateTime(Date.now(), settings.clock)}`;
    // Chrome suggests the page title as the PDF's file name.
    document.title = chatTitle;
    $('document').hidden = false;
  }

  async function run() {
    if (!SITES[platform] || !chatId) {
      showError('This link is missing the chat to export. Open the ChatStamp popup and try again.');
      return;
    }
    $('retry').hidden = true;
    $('state').textContent = 'Loading your chat and images…';
    try {
      const settings = await ChatStamp.storage.getSettings();
      const reply = (await askOpenTabs()) || (await askNewTab());
      if (!reply) {
        showError(`Couldn't reach ${siteName}. Open ${siteName} in a tab, make sure you're signed in, and try again.`);
      } else if (!reply.ok) {
        showError(`${siteName} didn't return this chat. It may have been deleted, or you may be signed out.`);
        ChatStamp.info('conversation request failed:', reply.error);
      } else if (!reply.messages.length) {
        showError('This chat has no messages to export.');
      } else {
        render(reply.messages, settings);
        $('state').textContent = 'Preparing images…';
        await imagesReady();
        $('state').textContent = 'In the print dialog, choose "Save as PDF" as the destination.';
        $('savePdf').hidden = false;
        setTimeout(() => window.print(), 150);
      }
    } catch (err) {
      ChatStamp.info('export failed:', err);
      showError(`Something went wrong loading this chat from ${siteName}. Try again.`);
    }
  }

  $('savePdf').addEventListener('click', () => window.print());
  $('retry').addEventListener('click', run);
  run();
})();
