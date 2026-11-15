// Renders zimone chapter Markdown into HTML.
//
// Chapter format (see reference/book.md for the authoring spec):
//   - Top-level blocks are separated by blank lines.
//   - Every top-level block ends with an attribute list: {#block-id key=value ...}
//     on its last line (or on the opening line of a ``` fence or ::: directive).
//   - Directives: ":::check {#id objective=O1}" ... ":::"  and
//                 ":::gloss {#id for=target-id}" ... ":::"
// Rendering never invents ids: a block without one is reported as an error.

import { createRequire } from 'node:module';

// Vendored markdown-it (see ../vendor/markdown-it/SOURCE.md). Raw HTML is off, so it is escaped.
const MarkdownIt = createRequire(import.meta.url)('../vendor/markdown-it/markdown-it.min.js');

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

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

// Only web, mail, in-page and relative links become links; anything else stays as literal text.
md.validateLink = (url) => /^(https?:|mailto:|#|\/|\.{0,2}\/)/i.test(url) || !/^[a-z][\w+.-]*:/i.test(url.trim());

const renderToken = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options);
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  if (/^https?:/i.test(tokens[idx].attrGet('href') ?? '')) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener');
  }
  return renderToken(tokens, idx, options, env, self);
};
// Books are text-only, and a remote image would load from a third party: show images as links.
md.renderer.rules.image = (tokens, idx) => {
  const t = tokens[idx];
  const alt = t.children?.map((c) => c.content).join('') || 'image';
  return `<a href="${escapeHtml(t.attrGet('src') ?? '')}" target="_blank" rel="noopener">${escapeHtml(alt)} (image)</a>`;
};
// A wide table scrolls sideways inside its wrapper, so it never widens the page or a message.
md.renderer.rules.table_open = () => '<div class="cx-table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

// Free-form Markdown (thread replies, directive bodies): no ids, no directives.
export function renderMarkdown(src) {
  // Trimmed so a block's text is exactly its content (question anchors compare text offsets).
  return md.render(src.replace(/\r\n/g, '\n')).trimEnd();
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
    if (p.kind === 'fence') return `<div class="cx-block"${blockAttr(p)}>${renderMarkdown(['```' + p.head.trim(), ...p.body, '```'].join('\n'))}</div>`;
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
    return `<div class="cx-block${invalid}"${blockAttr(p)}>${renderMarkdown(p.body.join('\n'))}</div>`;
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
