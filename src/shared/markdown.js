// Small Markdown-to-HTML converter for chat text on the print page. Everything is
// HTML-escaped first, so chat content can never inject markup or scripts.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const escapeHtml = (text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function inline(text) {
    return text
      .split(/(`[^`\n]+`)/)
      .map((part, i) => {
        if (i % 2) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        return escapeHtml(part)
          .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
          .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/(^|[^*])\*(?=[^\s*])([^*\n]+?)\*/g, '$1<em>$2</em>');
      })
      .join('');
  }

  const isTableRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
  const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim()));
  const BULLET = /^\s*[-*+]\s+(.*)$/;
  const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
  const FENCE = /^\s*(```|~~~)/;

  function startsBlock(line) {
    return FENCE.test(line) || /^#{1,6}\s/.test(line) || /^\s*>/.test(line) || BULLET.test(line) || NUMBERED.test(line) || /^\s*([-*_])\1{2,}\s*$/.test(line);
  }

  function markdownToHtml(source) {
    // Private-use characters are the sites' invisible citation markers.
    const lines = String(source).replace(/[-]/g, '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
      } else if (FENCE.test(line)) {
        const code = [];
        for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
        i++;
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      } else if (/^#{1,6}\s/.test(line)) {
        const level = Math.min(line.match(/^#+/)[0].length + 1, 6);
        html.push(`<h${level}>${inline(line.replace(/^#+\s+/, ''))}</h${level}>`);
        i++;
      } else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        html.push('<hr>');
        i++;
      } else if (/^\s*>/.test(line)) {
        const quote = [];
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
        html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      } else if (BULLET.test(line) || NUMBERED.test(line)) {
        const pattern = BULLET.test(line) ? BULLET : NUMBERED;
        const tag = pattern === BULLET ? 'ul' : 'ol';
        const items = [];
        for (; i < lines.length && pattern.test(lines[i]); i++) {
          items.push(`<li>${inline(lines[i].match(pattern)[1])}</li>`);
          while (i + 1 < lines.length && !lines[i + 1].trim() && pattern.test(lines[i + 2] || '')) i++;
        }
        html.push(`<${tag}>${items.join('')}</${tag}>`);
      } else if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
        const head = tableCells(line).map((cell) => `<th>${cell}</th>`).join('');
        const rows = [];
        for (i += 2; i < lines.length && lines[i].includes('|'); i++) {
          rows.push(`<tr>${tableCells(lines[i]).map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
        }
        html.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      } else {
        const paragraph = [];
        for (; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++) paragraph.push(inline(lines[i]));
        html.push(`<p>${paragraph.join('<br>')}</p>`);
      }
    }
    return html.join('');
  }

  // ChatGPT replies can be written in a layout language its own site turns into cards,
  // forms and logos: <box gap={3}>, <icon name="server"/>, <radio value="x">x</radio>,
  // {@body const [a, b] = DIL.useState("x")}. The language isn't documented, so names
  // aren't listed one by one: a reply showing clear signs of it has every tag removed,
  // keeping the words. A reply without those signs is left as it is, so ordinary
  // text like "use a <div>" survives. Code is never touched.
  const LAYOUT_SIGNS = new RegExp(
    [
      '<(?:box|row|column|col|stack|grid|badge|card|divider|spacer|icon|radio|radio-group|Entity|AsyncImage)\\b',
      '</(?:box|row|column|col|stack|grid|badge|card|radio|radio-group)>',
      '<(?:text|title|button)\\s+[\\w-]+=',
      '<[A-Za-z][\\w.-]*\\s[^>\\n]*=\\{',
      // HTML tags are lowercase, so a capitalised tag with attributes or a closing tag is markup.
      // Types like Map<String, Integer> have neither.
      '<[A-Z][\\w.-]*\\s+[\\w-]+=',
      '<[A-Z][\\w.]*\\s[^>\\n]*/>',
      '</[A-Z][\\w.-]*\\s*>',
      '\\{@\\w',
    ].join('|')
  );

  // Index just past the closing } of the { at `start`, or -1 if it never closes.
  function endOfBraces(text, start) {
    let depth = 0;
    let quote = '';
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i + 1;
    }
    return -1;
  }

  // Parses the tag at `start`, across lines and through nested {{...}} values. Returns
  // null if it isn't one, as in "3 < 4".
  function readTag(text, start) {
    const head = /^<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/.exec(text.slice(start, start + 80));
    if (!head) return null;
    for (let i = start + head[0].length; i < text.length; i++) {
      const c = text[i];
      if (c === '>') {
        return { closing: head[1] === '/', name: head[2], source: text.slice(start, i + 1), end: i + 1 };
      }
      if (c === '<') return null;
      if (c === '"' || c === "'") {
        i = text.indexOf(c, i + 1);
        if (i < 0) return null;
      } else if (c === '{') {
        const end = endOfBraces(text, i);
        if (end < 0) return null;
        i = end - 1;
      }
    }
    return null;
  }

  function removeLayout(text) {
    let out = '';
    let i = 0;
    while (i < text.length) {
      if (text.startsWith('{@', i)) {
        const end = endOfBraces(text, i);
        if (end > 0) {
          i = end;
          continue;
        }
      }
      // A word right before an opening tag means a type like Promise<Response>.
      const tag = text[i] === '<' ? readTag(text, i) : null;
      if (!tag || (!tag.closing && i > 0 && /\w/.test(text[i - 1]))) {
        out += text[i++];
        continue;
      }
      const name = tag.name.toLowerCase();
      i = tag.end;
      if (name === 'entity') out += (tag.source.match(/\bvalue="([^"]*)"/) || [])[1] || '';
      else if (name === 'title') out += '**';
      else if (name === 'radio' && !tag.closing) out += '- ';
      else if (name === 'button' && !tag.closing && !tag.source.endsWith('/>')) {
        // A button does nothing on paper, so its label goes too.
        const close = text.indexOf('</button>', i);
        if (close >= 0) i = close + '</button>'.length;
      }
    }
    // Leftover values like {backend} that the page would have filled in.
    return out.replace(/\{[A-Za-z_$][\w.$]*\}/g, '');
  }

  // Splits text into [fenced code, prose, ...] pieces, with `transform` applied to the prose
  // around inline code.
  function mapProse(source, transform) {
    const pieces = [];
    let prose = [];
    let fence = null;
    const flush = () => {
      if (!prose.length) return;
      const text = prose.join('\n');
      pieces.push({ code: false, text: text.split(/(`[^`\n]+`)/).map((part, i) => (i % 2 ? part : transform(part))).join('') });
      prose = [];
    };
    for (const line of String(source).split('\n')) {
      if (fence) {
        fence.push(line);
        if (FENCE.test(line)) {
          pieces.push({ code: true, text: fence.join('\n') });
          fence = null;
        }
      } else if (FENCE.test(line)) {
        flush();
        fence = [line];
      } else {
        prose.push(line);
      }
    }
    flush();
    if (fence) pieces.push({ code: true, text: fence.join('\n') });
    return pieces;
  }

  function stripChatUiTags(source) {
    let hasLayout = false;
    mapProse(source, (part) => {
      if (LAYOUT_SIGNS.test(part)) hasLayout = true;
      return part;
    });
    if (!hasLayout) return String(source);
    return mapProse(source, removeLayout)
      // Layout tags usually nest and indent the text between them, which would hide headings.
      .map((piece) => (piece.code ? piece.text : piece.text.split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()))
      .filter(Boolean)
      .join('\n\n');
  }

  ChatStamp.markdownToHtml = markdownToHtml;
  ChatStamp.stripChatUiTags = stripChatUiTags;
})();
