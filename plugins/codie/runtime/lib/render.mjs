// Renders codie chapter Markdown into HTML.
//
// Chapter format (see .claude/skills/codie/SKILL.md for the authoring spec):
//   - Top-level blocks are separated by blank lines.
//   - Every top-level block ends with an attribute list: {#block-id key=value ...}
//     on its last line (or on the opening line of a ``` fence or ::: directive).
//   - Directives: ":::check {#id objective=O1}" ... ":::"  and
//                 ":::gloss {#id for=target-id}" ... ":::"
// Rendering never invents ids: a block without one is reported as an error.

const ATTR_TAIL_RE = /\s*\{([^{}]*)\}\s*$/;
const DIRECTIVE_RE = /^:::(\w+)\s*(.*)$/;
const FENCE_RE = /^```(.*)$/;
const DIRECTIVE_TYPES = new Set(['check', 'gloss']);

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeHref(url) {
  if (/^(https?:|mailto:|#|\/|\.{0,2}\/)/i.test(url) || !/^[a-z][\w+.-]*:/i.test(url)) return url;
  return null;
}

export function renderInline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const href = safeHref(url);
    if (href === null) return text;
    const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${href}"${ext}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\s](?:[^*]*[^*\s])?)\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s](?:[^_]*[^_\s])?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return s;
}

// Parses "#id key=value key2="quoted value"". Returns {attrs, error}.
export function parseAttrs(src) {
  const attrs = {};
  const re = /#([\w-]+)|([\w-]+)=(?:"([^"]*)"|([^\s"]+))|(\S+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) {
      if (attrs.id) return { attrs, error: `more than one #id in {${src}}` };
      attrs.id = m[1];
    } else if (m[2]) {
      attrs[m[2]] = m[3] ?? m[4];
    } else {
      return { attrs, error: `unrecognised attribute "${m[5]}" in {${src}}` };
    }
  }
  return { attrs, error: null };
}

// Splits lines into raw blocks: {kind: 'text'|'fence'|'directive', lines, head, line}
function splitBlocks(lines, firstLineNo, errors) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const lineNo = firstLineNo + i;
    const dir = lines[i].match(DIRECTIVE_RE);
    const fence = lines[i].match(FENCE_RE);
    if (dir) {
      const end = lines.findIndex((l, j) => j > i && l.trim() === ':::');
      if (end === -1) {
        errors.push({ line: lineNo, message: `:::${dir[1]} directive is never closed with :::` });
        blocks.push({ kind: 'text', lines: lines.slice(i), line: lineNo });
        break;
      }
      blocks.push({ kind: 'directive', type: dir[1], head: dir[2], lines: lines.slice(i + 1, end), line: lineNo });
      i = end + 1;
    } else if (fence) {
      const end = lines.findIndex((l, j) => j > i && /^```\s*$/.test(l));
      if (end === -1) {
        errors.push({ line: lineNo, message: 'code fence is never closed' });
        blocks.push({ kind: 'text', lines: lines.slice(i), line: lineNo });
        break;
      }
      blocks.push({ kind: 'fence', head: fence[1], lines: lines.slice(i + 1, end), line: lineNo });
      i = end + 1;
    } else {
      const start = i;
      while (i < lines.length && lines[i].trim() !== '' && !DIRECTIVE_RE.test(lines[i]) && !FENCE_RE.test(lines[i])) i++;
      blocks.push({ kind: 'text', lines: lines.slice(start, i), line: lineNo });
    }
  }
  return blocks;
}

function renderList(lines, ordered) {
  const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
  const items = [];
  for (const l of lines) {
    if (marker.test(l)) items.push(l.replace(marker, ''));
    else if (items.length) items[items.length - 1] += ' ' + l.trim();
    else items.push(l.trim());
  }
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</${tag}>`;
}

// Renders the body of a plain text block (no attribute tail).
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// Splits a pipe-table row into cells, ignoring pipes escaped as \| or inside `code`.
function tableCells(line) {
  const row = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function renderTable(lines) {
  const align = tableCells(lines[1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
  const cell = (tag, text, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${renderInline(text)}</${tag}>`;
  const head = tableCells(lines[0]).map((c, i) => cell('th', c, i)).join('');
  const body = lines
    .slice(2)
    .map((l) => `<tr>${tableCells(l).map((c, i) => cell('td', c, i)).join('')}</tr>`)
    .join('');
  // The wrapper scrolls sideways on its own, so a wide table never widens the page or a message.
  return `<div class="cx-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderTextBlock(lines) {
  const first = lines[0];
  if (lines.length >= 2 && first.includes('|') && TABLE_SEP_RE.test(lines[1])) return renderTable(lines);
  const h = first.match(/^(#{1,6})\s+(.*)$/);
  if (h && lines.length === 1) return `<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`;
  if (lines.length === 1 && /^(-{3,}|\*{3,})\s*$/.test(first)) return '<hr>';
  if (lines.every((l) => /^>/.test(l))) {
    const inner = lines.map((l) => l.replace(/^>\s?/, ''));
    return `<blockquote>${renderMarkdown(inner.join('\n'))}</blockquote>`;
  }
  if (/^\s*[-*]\s+/.test(first)) return renderList(lines, false);
  if (/^\s*\d+[.)]\s+/.test(first)) return renderList(lines, true);
  return `<p>${renderInline(lines.join('\n'))}</p>`;
}

function renderFence(head, lines) {
  const lang = head.trim().split(/\s+/)[0];
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  return `<pre><code${cls}>${escapeHtml(lines.join('\n'))}</code></pre>`;
}

// Free-form Markdown (thread replies, directive bodies): no ids, no directives.
export function renderMarkdown(src) {
  const errors = [];
  const blocks = splitBlocks(src.replace(/\r\n/g, '\n').split('\n'), 1, errors);
  return blocks
    .map((b) => {
      if (b.kind === 'fence') return renderFence(b.head, b.lines);
      if (b.kind === 'directive') return renderTextBlock([`:::${b.type} ${b.head}`, ...b.lines, ':::']);
      return renderTextBlock(b.lines);
    })
    .join('\n');
}

function plainText(src) {
  return src.replace(/[*_`>#]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}

// Renders a chapter. Returns {html, blocks, errors}.
// blocks: [{id, type, line, text, objective?, for?}]
export function renderChapter(src) {
  const errors = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const raw = splitBlocks(lines, 1, errors);
  const parsed = [];

  for (const b of raw) {
    let attrSrc = null;
    let body = b.lines;
    if (b.kind === 'text') {
      const last = body[body.length - 1];
      const m = last.match(ATTR_TAIL_RE);
      if (m) {
        attrSrc = m[1];
        body = [...body.slice(0, -1), last.slice(0, m.index)].filter((l, idx, arr) => idx < arr.length - 1 || l.trim() !== '');
      }
    } else {
      const m = (b.head || '').match(ATTR_TAIL_RE);
      if (m) {
        attrSrc = m[1];
        b.head = b.head.slice(0, m.index);
      }
    }
    let attrs = {};
    if (attrSrc === null) {
      errors.push({ line: b.line, message: 'block has no {#id} attribute' });
    } else {
      const res = parseAttrs(attrSrc);
      attrs = res.attrs;
      if (res.error) errors.push({ line: b.line, message: res.error });
      else if (!attrs.id) errors.push({ line: b.line, message: `attribute list {${attrSrc}} has no #id` });
    }
    if (b.kind === 'directive' && !DIRECTIVE_TYPES.has(b.type)) {
      errors.push({ line: b.line, message: `unknown directive :::${b.type}` });
    }
    if (b.kind === 'text' && body.length === 0) {
      errors.push({ line: b.line, message: 'block contains only an attribute list' });
    }
    parsed.push({ ...b, body, attrs });
  }

  const seen = new Map();
  for (const p of parsed) {
    const id = p.attrs.id;
    if (!id) continue;
    if (seen.has(id)) errors.push({ line: p.line, message: `duplicate id #${id} (first used on line ${seen.get(id)})` });
    else seen.set(id, p.line);
  }

  const glossesFor = new Map();
  for (const p of parsed) {
    if (p.kind !== 'directive' || p.type !== 'gloss') continue;
    const target = p.attrs.for;
    if (!target) errors.push({ line: p.line, message: `gloss #${p.attrs.id ?? '?'} has no for=<block-id>` });
    else if (!seen.has(target)) errors.push({ line: p.line, message: `gloss #${p.attrs.id ?? '?'} targets unknown block #${target}` });
    else {
      if (!glossesFor.has(target)) glossesFor.set(target, []);
      glossesFor.get(target).push(p);
    }
  }

  const blockAttr = (p) => (p.attrs.id ? ` data-block-id="${escapeHtml(p.attrs.id)}"` : '');
  const renderOne = (p) => {
    if (p.kind === 'fence') return `<div class="cx-block"${blockAttr(p)}>${renderFence(p.head, p.body)}</div>`;
    if (p.kind === 'directive' && p.type === 'check') {
      const obj = p.attrs.objective ? ` data-objective="${escapeHtml(p.attrs.objective)}"` : '';
      return `<section class="cx-block cx-check"${blockAttr(p)}${obj}><div class="cx-check-label">Check your understanding</div><div class="cx-check-q">${renderMarkdown(p.body.join('\n'))}</div></section>`;
    }
    if (p.kind === 'directive' && p.type === 'gloss') {
      return `<aside class="cx-block cx-gloss"${blockAttr(p)} data-for="${escapeHtml(p.attrs.for)}">${renderMarkdown(p.body.join('\n'))}</aside>`;
    }
    if (p.kind === 'directive') {
      return `<div class="cx-block cx-invalid"${blockAttr(p)}>${renderMarkdown(p.body.join('\n'))}</div>`;
    }
    if (p.body.length === 0) return '';
    const invalid = p.attrs.id ? '' : ' cx-invalid';
    return `<div class="cx-block${invalid}"${blockAttr(p)}>${renderTextBlock(p.body)}</div>`;
  };

  const out = [];
  for (const p of parsed) {
    if (p.kind === 'directive' && p.type === 'gloss' && glossesFor.get(p.attrs.for)?.includes(p)) continue;
    out.push(renderOne(p));
    for (const g of glossesFor.get(p.attrs.id) ?? []) out.push(renderOne(g));
  }

  const blocks = parsed
    .filter((p) => p.attrs.id)
    .map((p) => ({
      id: p.attrs.id,
      type: p.kind === 'directive' ? p.type : p.kind === 'fence' ? 'code' : 'text',
      line: p.line,
      text: plainText(p.body.join('\n')),
      ...(p.attrs.objective ? { objective: p.attrs.objective } : {}),
      ...(p.attrs.for ? { for: p.attrs.for } : {}),
    }));

  errors.sort((a, b) => a.line - b.line);
  return { html: out.join('\n'), blocks, errors };
}
