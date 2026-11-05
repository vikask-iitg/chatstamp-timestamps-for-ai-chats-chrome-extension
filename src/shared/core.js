// Shared namespace for all extension scripts. Content scripts in MV3 cannot be
// ES modules, so every file attaches itself to globalThis.ChatStamp instead.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  // Unpacked (development) installs have no update_url in their manifest.
  const DEV = !('update_url' in chrome.runtime.getManifest());

  ChatStamp.log = (...args) => {
    if (DEV) console.debug('[ChatStamp]', ...args);
  };

  // Like log, but shown at the Console's default level. For short status lines.
  ChatStamp.info = (...args) => {
    if (DEV) console.info('[ChatStamp]', ...args);
  };

  ChatStamp.platforms = ChatStamp.platforms || {};

  ChatStamp.PLATFORM_NAMES = { chatgpt: 'ChatGPT', claude: 'Claude' };

  ChatStamp.DEFAULT_SETTINGS = {
    dateFormat: 'datetime', // 'datetime' | 'auto' | 'relative' | 'absolute'
    clock: '12', // '12' | '24'
    groupBy: 'day', // popup grouping: 'day' | 'month' | 'none'
    theme: 'light', // popup and settings pages: 'light' | 'dark'
    timestamps: true, // master switch: false hides every label on the chat sites
    messageTimes: true, // show a date and time on each message inside a chat
    pdfButton: true, // show a Print as PDF button beside Share on an open chat
    enabled: { chatgpt: true, claude: true },
  };

  ChatStamp.debounce = (fn, ms) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  // Follows parent links from a leaf back to the root and returns the branch
  // root-first. Used to find the messages currently shown in a chat tree.
  ChatStamp.walkBranch = (byId, leafId, parentOf) => {
    const branch = [];
    const seen = new Set();
    for (let id = leafId; id && byId[id] && !seen.has(id); id = parentOf(byId[id])) {
      seen.add(id);
      branch.push(byId[id]);
    }
    return branch.reverse();
  };

  // Requests to the site give up after this long, so a stalled one can't block retries.
  ChatStamp.REQUEST_TIMEOUT_MS = 15 * 1000;
  ChatStamp.timeoutSignal = () => AbortSignal.timeout(ChatStamp.REQUEST_TIMEOUT_MS);

  // Images for the print page. Inlined as data: URLs, so they still show once the site's
  // tab has closed. A site's file host may refuse this; then the plain URL is returned for
  // an <img> to load, which isn't subject to the same limit. null means no usable image.
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  ChatStamp.MAX_IMAGES_PER_CHAT = 40;
  ChatStamp.loadImage = async (url, headers) => {
    let res;
    try {
      res = await fetch(url, { credentials: 'include', headers, signal: ChatStamp.timeoutSignal() });
    } catch (err) {
      return /^https:/i.test(url) ? url : null;
    }
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type.split(';')[0]};base64,${btoa(binary)}`;
  };

  ChatStamp.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Accepts ISO strings, epoch seconds or epoch milliseconds; returns ms or null.
  ChatStamp.toMillis = (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value < 1e12 ? Math.round(value * 1000) : value;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  };
})();
