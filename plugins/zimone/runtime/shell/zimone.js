// zimone page: renders a unit, anchors questions to passages, and talks to the zimone server.

const $ = (id) => document.getElementById(id);
const els = {
  title: $('cx-workbook-title'),
  conn: $('cx-conn'),
  toggle: $('cx-toggle-side'),
  side: $('cx-side'),
  closeSide: $('cx-close-side'),
  banner: $('cx-banner'),
  content: $('cx-content'),
  finish: $('cx-finish'),
  finishBtn: $('cx-finish-btn'),
  finishNote: $('cx-finish-note'),
  pager: $('cx-pager'),
  compose: $('cx-compose'),
  composeAttach: $('cx-compose-attach'),
  composeQuote: $('cx-compose-quote'),
  composeUnquote: $('cx-compose-unquote'),
  composeText: $('cx-compose-text'),
  threads: $('cx-threads'),
  empty: $('cx-threads-empty'),
  askSel: $('cx-ask-sel'),
  toast: $('cx-toast'),
};

const state = {
  unitId: null, // the unit on screen, or null on the contents page
  terms: null, // workbook.json's display terms: { unit: [singular, plural], workbook: [...] }
  threads: new Map(), // id -> thread
  anchors: new Map(), // thread id -> 'ok' | 'block' | 'scope' | 'quote-changed' | 'block-missing'
  pendingAnchor: null, // anchor for the ask composer
  selAnchor: null, // anchor for the floating button
  openThread: null, // id of the one expanded thread in the sidebar, or null
  drafts: new Map(), // thread id -> unsent follow-up text (survives collapsing)
  wasDown: false,
  streamLive: false,
  agentOnline: null, // whether a session is watching this workbook; null until the server says
};

// ---------------------------------------------------------------- utilities

async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c) n.append(c);
  return n;
}

let toastTimer;
// action: optional {label, run} rendered as a button in the toast.
function toast(msg, action) {
  els.toast.replaceChildren(document.createTextNode(msg));
  if (action) {
    els.toast.append(
      el('button', {
        type: 'button',
        class: 'cx-toast-action',
        text: action.label,
        onclick: () => {
          els.toast.hidden = true;
          action.run();
        },
      }),
    );
  }
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), action ? 6000 : 3500);
}

function reportError(err) {
  console.error(err);
  toast(err.message);
}

// Display terms from workbook.json: term('unit') is "unit" (or "chapter", …), term('unit', true) its plural.
const term = (key, plural = false) => (state.terms ? state.terms[key][plural ? 1 : 0] : key);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const awayHint = () => `No Claude session is watching this ${term('workbook')}. Run /zimone:open in its folder; messages wait until then.`;

// The header shows the page's link to the server and, when that's up, whether a session is watching.
function renderConn() {
  const s = !state.streamLive ? (state.wasDown ? 'down' : 'connecting') : state.agentOnline === false ? 'away' : 'live';
  els.conn.dataset.state = s;
  els.conn.textContent = { live: 'live', away: 'zimone away', down: 'disconnected', connecting: 'connecting' }[s];
  els.conn.title = s === 'away' ? awayHint() : 'Connection to the zimone server';
}

// Text for a thread still waiting on zimone: queued (not yet seen) or delivered (seen, no reply yet).
function pendingText(status) {
  if (state.agentOnline === false) return `Waiting for zimone. ${awayHint()}`;
  return status === 'queued' ? 'Waiting for zimone…' : 'zimone is thinking…';
}

// Sidebar state. Wide screens default to open and remember the user's choice; narrow screens
// show it as an overlay that starts closed. Both classes are set so either layout reads them.
const SIDE_KEY = 'zimone.sideClosed';
const narrow = window.matchMedia('(max-width: 900px)');

function setSide(open, { remember = false } = {}) {
  document.body.classList.toggle('cx-side-open', open);
  document.body.classList.toggle('cx-side-closed', !open);
  els.toggle.setAttribute('aria-expanded', String(open));
  if (remember && !narrow.matches) {
    try {
      localStorage.setItem(SIDE_KEY, open ? '0' : '1');
    } catch {
      // Storage unavailable (private window, blocked site data): the choice lasts for this page only.
    }
  }
}

function initialSideOpen() {
  if (narrow.matches) return false;
  try {
    return localStorage.getItem(SIDE_KEY) !== '1';
  } catch {
    return true; // storage unavailable: use the wide-screen default
  }
}

function openSide() {
  setSide(true);
}

setSide(initialSideOpen());

// Sidebar width (wide screens only): drag the left edge, use arrow keys on it, double-click to reset.
const WIDTH_KEY = 'zimone.sideWidth';
const MIN_SIDE_W = 280;
const maxSideWidth = () => Math.max(MIN_SIDE_W, Math.min(760, Math.round(window.innerWidth * 0.6)));
const resizer = $('cx-resize');
let sideWidth = null; // null: the stylesheet's default width

function setSideWidth(w, { remember = false } = {}) {
  sideWidth = Math.round(Math.min(maxSideWidth(), Math.max(MIN_SIDE_W, w)));
  document.documentElement.style.setProperty('--side-w', `${sideWidth}px`);
  if (remember) {
    try {
      localStorage.setItem(WIDTH_KEY, String(sideWidth));
    } catch {
      // Storage unavailable: the width lasts for this page only.
    }
  }
}

function resetSideWidth() {
  sideWidth = null;
  document.documentElement.style.removeProperty('--side-w');
  try {
    localStorage.removeItem(WIDTH_KEY);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}

try {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  if (saved > 0) setSideWidth(saved);
} catch {
  // Storage unavailable: start at the default width.
}

resizer.addEventListener('pointerdown', (ev) => {
  if (narrow.matches || ev.button !== 0) return;
  ev.preventDefault();
  resizer.setPointerCapture(ev.pointerId);
  document.body.classList.add('cx-resizing');
  const move = (e) => setSideWidth(window.innerWidth - e.clientX);
  const up = () => {
    resizer.removeEventListener('pointermove', move);
    document.body.classList.remove('cx-resizing');
    if (sideWidth !== null) setSideWidth(sideWidth, { remember: true });
  };
  resizer.addEventListener('pointermove', move);
  resizer.addEventListener('pointerup', up, { once: true });
  resizer.addEventListener('pointercancel', up, { once: true });
});
resizer.addEventListener('keydown', (ev) => {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  ev.preventDefault();
  const current = sideWidth ?? els.side.getBoundingClientRect().width;
  setSideWidth(current + (ev.key === 'ArrowLeft' ? 24 : -24), { remember: true });
});
resizer.addEventListener('dblclick', resetSideWidth);
window.addEventListener('resize', () => {
  if (sideWidth !== null) setSideWidth(sideWidth); // keep within the new window's limits
});

// ---------------------------------------------------------------- text anchoring

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  return out;
}

const blockText = (root) => textNodes(root).map((n) => n.data).join('');

function offsetIn(root, container, offset) {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(container, offset);
  return r.toString().length;
}

// The part of a block that questions can anchor to (checks exclude their form and feedback).
const anchorRoot = (block) => block.querySelector(':scope > .cx-check-q') || block;

const blockEl = (id) => els.content.querySelector(`[data-block-id="${CSS.escape(id)}"]`);

function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
function commonSuffixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function locate(root, quote, prefix, suffix) {
  const text = blockText(root);
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const score = commonSuffixLen(text.slice(0, i), prefix) + commonPrefixLen(text.slice(i + quote.length), suffix);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

function wrapRange(root, start, end, threadId) {
  const segs = [];
  let pos = 0;
  for (const n of textNodes(root)) {
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + n.data.length);
    if (s < e) segs.push([n, s - pos, e - pos]);
    pos += n.data.length;
  }
  for (const [n, s, e] of segs) {
    let target = n;
    if (s > 0) target = target.splitText(s);
    if (e - s < target.data.length) target.splitText(e - s);
    if (!target.data.trim()) continue;
    const mark = el('mark', { class: 'cx-mark', 'data-thread-id': threadId });
    target.parentNode.replaceChild(mark, target);
    mark.append(target);
  }
}

function applyMark(t) {
  if (!t.anchor) return 'scope';
  const block = blockEl(t.anchor.block);
  if (!block) return 'block-missing';
  if (!t.anchor.quote) return 'block';
  const root = anchorRoot(block);
  const start = locate(root, t.anchor.quote, t.anchor.prefix, t.anchor.suffix);
  if (start === -1) return 'quote-changed';
  wrapRange(root, start, start + t.anchor.quote.length, t.id);
  return 'ok';
}

function selectionAnchor() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!els.content.contains(range.commonAncestorContainer)) return null;
  const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const block = startEl.closest('[data-block-id]');
  if (!block || !els.content.contains(block)) return null;
  const root = anchorRoot(block);
  if (!root.contains(range.startContainer)) return null;
  const r = range.cloneRange();
  if (!root.contains(r.endContainer)) r.setEnd(root, root.childNodes.length);
  const raw = r.toString();
  const quote = raw.trim();
  if (!quote) return null;
  const start = offsetIn(root, r.startContainer, r.startOffset) + (raw.length - raw.trimStart().length);
  const text = blockText(root);
  return {
    block: block.dataset.blockId,
    quote,
    prefix: text.slice(Math.max(0, start - 40), start),
    suffix: text.slice(start + quote.length, start + quote.length + 40),
    rect: range.getBoundingClientRect(),
  };
}

// ---------------------------------------------------------------- threads

function statusLine(t) {
  if (t.status === 'queued' || t.status === 'delivered') return el('div', { class: 'cx-status', 'data-status': t.status, text: pendingText(t.status) });
  return null;
}

// System messages carry a structured notice; the page words it with the workbook's terms.
function noticeText(n) {
  if (n.type === 'unit_state' && n.state === 'done') {
    return n.next_unit ? `You marked this ${term('unit')} done. zimone will prepare the next one.` : `You marked the last ${term('unit')} done.`;
  }
  return `${n.type}: ${n.state}`;
}

const CONFIDENCE = ['', 'guessing', 'fairly sure', 'certain'];

function messageEl(m) {
  if (m.role === 'system') return el('div', { class: 'cx-msg cx-msg-system', text: m.notice ? noticeText(m.notice) : m.text });
  if (m.role === 'agent') {
    return el('div', { class: 'cx-msg cx-msg-agent' }, el('div', { class: 'cx-msg-label', text: 'zimone' }), el('div', { html: m.html }));
  }
  const conf = m.fields?.confidence ? ` · ${CONFIDENCE[m.fields.confidence]}` : '';
  return el('div', { class: 'cx-msg' }, conf ? el('div', { class: 'cx-msg-label', text: `Your answer${conf}` }) : null, el('div', { class: 'cx-msg-user', text: m.text }));
}

// Threads come in three shapes: the unit's (or workbook's) own thread, which has no anchor; a
// question about a passage (anchored with a quote); and responses to a whole block such as a check,
// shown inside that block when it has a place for them.
const isScopeThread = (t) => t.anchor === null;
const blockBox = (t) => (t.anchor && !t.anchor.quote ? blockEl(t.anchor.block)?.querySelector(':scope > .cx-feedback') : null);

// Which replies the user has seen, per browser: {"<thread id>@<created>": agent reply count}.
// Keyed with the creation time because thread ids restart when a workbook's server state is reset.
const SEEN_KEY = 'zimone.seenReplies';
const threadKey = (t) => `${t.id}@${t.created}`;
const replyCount = (t) => t.messages.filter((m) => m.role === 'agent').length;
const seen = (() => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
  } catch {
    return {}; // storage unavailable or unreadable: unread dots last for this page only
  }
})();
const isUnread = (t) => replyCount(t) > (seen[threadKey(t)] ?? 0);

function markSeen(t) {
  const n = replyCount(t);
  if ((seen[threadKey(t)] ?? 0) >= n) return;
  seen[threadKey(t)] = n;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // storage unavailable: the read state lasts for this page only
  }
}

function jumpTo(t) {
  const target = els.content.querySelector(`mark[data-thread-id="${t.id}"]`) || (t.anchor && blockEl(t.anchor.block));
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setActive(t.id);
}

function setActive(threadId) {
  for (const n of document.querySelectorAll('.cx-active')) n.classList.remove('cx-active');
  if (!threadId) return;
  for (const n of els.content.querySelectorAll(`mark[data-thread-id="${threadId}"]`)) n.classList.add('cx-active');
  const card = els.threads.querySelector(`[data-thread-id="${threadId}"]`);
  if (card) {
    card.classList.add('cx-active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Expands one thread (collapsing any other), or collapses all with null.
function openThread(id) {
  const prev = state.openThread;
  state.openThread = id;
  for (const tid of new Set([prev, id])) {
    const t = tid && state.threads.get(tid);
    if (!t) continue;
    if (tid === id) markSeen(t);
    replaceCard(t);
  }
  setActive(id);
}

function chipText(t) {
  if (t.status === 'queued') return 'waiting';
  if (t.status === 'delivered') return state.agentOnline === false ? 'waiting' : 'thinking…';
  if (isScopeThread(t)) return t.messages.length === 1 ? '1 message' : `${t.messages.length} messages`;
  const n = replyCount(t);
  return n === 0 ? 'no reply' : n === 1 ? '1 reply' : `${n} replies`;
}

const anchorNotes = () => ({
  'quote-changed': ['passage revised', 'This passage has been revised since you asked.'],
  'block-missing': ['passage removed', `This passage is no longer in the ${term('unit')}.`],
});

function threadCard(t) {
  const open = state.openThread === t.id;
  const note = anchorNotes()[state.anchors.get(t.id)];
  const convo = isScopeThread(t);
  const quote = t.anchor?.quote ?? null;
  // The scope thread previews its latest message; a passage thread previews the question that started it.
  const latest = t.messages[t.messages.length - 1];
  const rawPreview = convo ? (latest?.notice ? noticeText(latest.notice) : (latest?.text ?? '')) : (t.messages.find((m) => m.role === 'user')?.text ?? '');
  // zimone's messages are Markdown; show links and emphasis as plain text in the one-line preview.
  const preview = rawPreview.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '');
  const label = convo ? (t.unit ? `Conversation about this ${term('unit')}` : `Conversation about the ${term('workbook')}`) : (quote ?? `About block #${t.anchor.block}`);
  const head = el(
    'button',
    { type: 'button', class: 'cx-thread-head', 'aria-expanded': String(open), onclick: () => openThread(open ? null : t.id) },
    el('span', { class: quote ? 'cx-thread-quote' : 'cx-thread-quote cx-thread-scope', text: label }),
    open ? null : el('span', { class: 'cx-thread-q', text: preview }),
    el(
      'span',
      { class: 'cx-thread-tags' },
      el('span', { class: `cx-chip cx-chip-${t.status}`, text: chipText(t) }),
      !open && isUnread(t) ? el('span', { class: 'cx-new', text: 'new' }) : null,
      note ? el('span', { class: 'cx-detached', text: note[0] }) : null,
    ),
  );
  const card = el('div', { class: convo ? 'cx-thread cx-thread-convo' : 'cx-thread', 'data-thread-id': t.id, 'data-open': String(open) }, head);
  if (!open) return card;

  const body = el('div', { class: 'cx-thread-body' });
  if (quote) body.append(el('blockquote', { class: 'cx-quote', 'data-jump': true, title: 'Show in text', text: quote, onclick: () => jumpTo(t) }));
  if (note) body.append(el('div', { class: 'cx-thread-meta cx-detached', text: note[1] }));
  for (const m of t.messages) body.append(messageEl(m));
  const status = statusLine(t);
  if (status) body.append(status);
  if (convo) {
    // The message box at the bottom of the sidebar is this thread's input.
    card.append(body);
    return card;
  }

  const text = el('textarea', { rows: 1, placeholder: 'Follow up…', required: true });
  text.value = state.drafts.get(t.id) ?? '';
  text.addEventListener('input', () => state.drafts.set(t.id, text.value));
  const form = el('form', { class: 'cx-followup' }, text, el('div', { class: 'cx-row' }, el('button', { type: 'submit', class: 'cx-btn cx-btn-quiet', text: 'Send' })));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const question = text.value.trim();
    if (!question) return;
    // Clear first: a live update may replace this card before the request returns.
    text.value = '';
    state.drafts.delete(t.id);
    try {
      upsertThread(await api('/api/messages', { thread_id: t.id, text: question }));
    } catch (err) {
      reportError(err);
      state.drafts.set(t.id, question);
      const current = els.threads.querySelector(`[data-thread-id="${t.id}"] .cx-followup textarea`);
      if (current) current.value = question;
    }
  });
  text.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) form.requestSubmit();
  });
  body.append(form);
  card.append(body);
  return card;
}

function blockOrder() {
  const order = new Map();
  els.content.querySelectorAll('[data-block-id]').forEach((n, i) => order.set(n.dataset.blockId, i));
  return order;
}

function renderThreads() {
  const order = blockOrder();
  const all = [...state.threads.values()];
  const convo = all.filter(isScopeThread);
  const anchored = all.filter((t) => !isScopeThread(t) && !blockBox(t));
  anchored.sort((a, b) => (order.get(a.anchor.block) ?? -1) - (order.get(b.anchor.block) ?? -1) || a.created.localeCompare(b.created));
  els.threads.replaceChildren(...[...convo, ...anchored].map(threadCard));
  els.empty.hidden = convo.length + anchored.length > 0;
  els.empty.textContent = state.unitId
    ? 'Message zimone below, or select a passage to ask about it.'
    : `Message zimone below about the ${term('workbook')}: what to cover next, how it’s going, anything.`;
}

function replaceCard(t) {
  const old = els.threads.querySelector(`[data-thread-id="${t.id}"]`);
  if (!old) return renderThreads();
  const focused = old.contains(document.activeElement) ? document.activeElement : null;
  const card = threadCard(t);
  if (old.classList.contains('cx-active')) card.classList.add('cx-active');
  old.replaceWith(card);
  if (focused?.matches('textarea')) card.querySelector('.cx-followup textarea')?.focus();
  else if (focused?.matches('.cx-thread-head')) card.querySelector('.cx-thread-head').focus();
}

function upsertThread(t) {
  const prev = state.threads.get(t.id);
  state.threads.set(t.id, t);
  if (blockBox(t)) return renderBlockThread(t);
  if (!prev) state.anchors.set(t.id, applyMark(t));
  const visible = t.id === state.openThread && document.body.classList.contains('cx-side-open');
  if (visible) markSeen(t);
  replaceCard(t);
  if (prev && replyCount(t) > replyCount(prev) && !visible) {
    toast(isScopeThread(t) ? 'New message from zimone' : 'zimone answered', {
      label: 'Show',
      run: () => {
        openSide();
        openThread(t.id);
      },
    });
  }
}

// ---------------------------------------------------------------- checks

function decorateChecks() {
  for (const check of els.content.querySelectorAll('.cx-check')) {
    const id = check.dataset.blockId;
    if (!id) continue;
    const text = el('textarea', { placeholder: 'Answer in your own words…', 'aria-label': 'Your answer' });
    const conf = el('fieldset', { class: 'cx-conf' }, el('legend', { text: 'How sure are you?' }));
    [['1', 'Guessing'], ['2', 'Fairly sure'], ['3', 'Certain']].forEach(([v, label]) => {
      conf.append(el('label', {}, el('input', { type: 'radio', name: `conf-${id}`, value: v }), document.createTextNode(label)));
    });
    const submit = el('button', { type: 'submit', class: 'cx-btn', text: 'Submit answer' });
    const form = el('form', { class: 'cx-check-form' }, text, conf, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const response = text.value.trim();
      const picked = form.querySelector('input[type=radio]:checked');
      if (!response) return toast('Write an answer first.');
      if (!picked) return toast('Say how sure you are.');
      submit.disabled = true;
      try {
        upsertThread(await api('/api/messages', { unit: state.unitId, anchor: { block: id }, text: response, fields: { confidence: Number(picked.value) } }));
        text.value = '';
        picked.checked = false;
      } catch (err) {
        reportError(err);
      } finally {
        submit.disabled = false;
      }
    });
    check.append(form, el('div', { class: 'cx-feedback' }));
  }
}

// Shows a whole-block thread (the responses to a check) inside its block.
function renderBlockThread(t) {
  const box = blockBox(t);
  if (!box) return;
  const status = statusLine(t);
  box.replaceChildren(...t.messages.map(messageEl), ...(status ? [status] : []));
  const submit = box.parentElement.querySelector('.cx-check-form button[type=submit]');
  if (submit) submit.textContent = t.messages.length ? 'Try again' : 'Submit answer';
}

// ---------------------------------------------------------------- views

function scrollAnchor() {
  for (const n of els.content.querySelectorAll('[data-block-id]')) {
    const r = n.getBoundingClientRect();
    if (r.bottom > 60) return { id: n.dataset.blockId, top: r.top };
  }
  return null;
}

function checkDrafts() {
  const drafts = new Map();
  for (const check of els.content.querySelectorAll('.cx-check')) {
    const text = check.querySelector('textarea')?.value;
    const conf = check.querySelector('input[type=radio]:checked')?.value;
    if (text || conf) drafts.set(check.dataset.blockId, { text, conf });
  }
  return drafts;
}

function renderPager(u) {
  const side = (n, prev) => {
    if (!n) return el('span');
    if (!n.exists) return el('span', { text: `${prev ? 'Previous' : 'Next'}: ${n.title} (not written yet)` });
    return el('a', { href: `/u/${n.id}`, text: prev ? `← ${n.title}` : `${n.title} →` });
  };
  els.pager.replaceChildren(side(u.prev, true), side(u.next, false));
}

async function loadUnit(id, { preserve = false } = {}) {
  const anchor = preserve ? scrollAnchor() : null;
  const drafts = preserve ? checkDrafts() : new Map();
  let wb, unit, threads;
  try {
    [wb, unit, { threads }] = await Promise.all([api('/api/workbook'), api(`/api/units/${id}`), api(`/api/threads?unit=${encodeURIComponent(id)}`)]);
  } catch (err) {
    els.banner.hidden = false;
    els.banner.textContent = err.message;
    els.content.replaceChildren();
    els.finish.hidden = true;
    return;
  }
  state.unitId = id;
  state.terms = wb.terms;
  renderConn();
  els.composeText.placeholder = composePlaceholder();
  els.title.textContent = wb.title;
  document.title = `${unit.title} · ${wb.title}`;

  els.banner.hidden = unit.errors.length === 0;
  if (unit.errors.length) {
    els.banner.replaceChildren(
      document.createTextNode(`This ${term('unit')} has formatting errors (zimone has been asked to keep them valid):`),
      el('ul', {}, ...unit.errors.map((e) => el('li', { text: `line ${e.line}: ${e.message}` }))),
    );
  }

  els.content.innerHTML = unit.html;
  decorateChecks();
  state.threads = new Map(threads.map((t) => [t.id, t]));
  state.anchors = new Map();
  for (const t of threads) {
    if (blockBox(t)) renderBlockThread(t);
    else state.anchors.set(t.id, applyMark(t));
  }
  renderThreads();

  for (const [checkId, d] of drafts) {
    const check = blockEl(checkId);
    if (!check) continue;
    if (d.text) check.querySelector('textarea').value = d.text;
    if (d.conf) check.querySelector(`input[value="${d.conf}"]`).checked = true;
  }

  renderPager(unit);
  els.finish.hidden = false;
  els.finishBtn.textContent = `I've finished this ${term('unit')}`;
  els.finishNote.textContent =
    unit.state === 'done' ? `You marked this ${term('unit')} done.` : `Tells zimone to prepare the next ${term('unit')} based on how this one went.`;

  if (anchor) {
    const n = blockEl(anchor.id);
    if (n) window.scrollBy(0, n.getBoundingClientRect().top - anchor.top);
  }
}

async function loadToc() {
  document.body.classList.add('cx-toc-view');
  let wb, threads;
  try {
    [wb, { threads }] = await Promise.all([api('/api/workbook'), api('/api/threads?unit=')]);
  } catch (err) {
    els.banner.hidden = false;
    els.banner.textContent = err.message;
    return;
  }
  state.terms = wb.terms;
  renderConn();
  els.title.textContent = wb.title;
  document.title = wb.title;
  const items = wb.units.map((u) => {
    const tag = u.state ? el('span', { class: 'cx-tag', text: u.state }) : null;
    if (!u.exists) return el('li', { class: 'cx-pending' }, document.createTextNode(u.title), el('span', { class: 'cx-tag', text: 'not written yet' }));
    return el('li', {}, el('a', { href: `/u/${u.id}`, text: u.title }), tag);
  });
  els.content.replaceChildren(
    el('div', { class: 'cx-toc' }, el('h1', { text: wb.title }), wb.subtitle ? el('p', { class: 'cx-subtitle', text: wb.subtitle }) : null, el('h2', { text: 'Contents' }), el('ol', {}, ...items)),
  );
  state.threads = new Map(threads.map((t) => [t.id, t]));
  els.composeText.placeholder = composePlaceholder();
  renderThreads();
}

// ---------------------------------------------------------------- compose

const composePlaceholder = () =>
  state.pendingAnchor ? 'Ask about this passage…' : `Message zimone about this ${term(state.unitId ? 'unit' : 'workbook')}…`;

// Attaches a passage to the message box (or detaches it with null).
function attachPassage(anchor) {
  state.pendingAnchor = anchor;
  els.composeAttach.hidden = !anchor;
  els.composeQuote.textContent = anchor ? anchor.quote : '';
  els.composeText.placeholder = composePlaceholder();
}

function focusCompose(anchor) {
  attachPassage(anchor);
  openSide();
  els.composeText.focus();
}

els.compose.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = els.composeText.value.trim();
  if (!text) return;
  const a = state.pendingAnchor;
  const btn = els.compose.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    // With a passage attached, the message starts its own thread; otherwise it joins the unit's thread.
    const anchor = a ? { block: a.block, quote: a.quote, prefix: a.prefix, suffix: a.suffix } : null;
    const t = await api('/api/messages', { unit: state.unitId, anchor, text });
    els.composeText.value = '';
    attachPassage(null);
    getSelection().removeAllRanges();
    upsertThread(t);
    openThread(t.id);
  } catch (err) {
    reportError(err);
  } finally {
    btn.disabled = false;
  }
});
els.composeText.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) els.compose.requestSubmit();
  if (ev.key === 'Escape' && state.pendingAnchor) attachPassage(null);
});
els.composeUnquote.addEventListener('click', () => {
  attachPassage(null);
  els.composeText.focus();
});
els.toggle.addEventListener('click', () => setSide(!document.body.classList.contains('cx-side-open'), { remember: true }));
els.closeSide.addEventListener('click', () => {
  setSide(false, { remember: true });
  els.toggle.focus();
});
// Esc closes the sidebar, unless it's being used to leave a text field (the composer handles its own Esc).
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || (ev.target instanceof Element && ev.target.closest('textarea, input'))) return;
  if (document.body.classList.contains('cx-side-open')) setSide(false, { remember: true });
});

// Floating "Ask about this" button for selections.
function updateAskButton() {
  const a = state.unitId ? selectionAnchor() : null;
  state.selAnchor = a;
  if (!a) {
    els.askSel.hidden = true;
    return;
  }
  els.askSel.hidden = false;
  const w = els.askSel.offsetWidth;
  const x = Math.min(Math.max(8, a.rect.right - w), window.innerWidth - w - 8);
  const y = a.rect.bottom + 8 > window.innerHeight - 40 ? a.rect.top - 40 : a.rect.bottom + 8;
  els.askSel.style.left = `${x}px`;
  els.askSel.style.top = `${y}px`;
}
document.addEventListener('mouseup', () => setTimeout(updateAskButton, 0));
document.addEventListener('keyup', (ev) => ev.shiftKey && updateAskButton());
document.addEventListener('selectionchange', () => {
  if (getSelection().isCollapsed) els.askSel.hidden = true;
});
window.addEventListener('scroll', () => (els.askSel.hidden = true), { passive: true });
els.askSel.addEventListener('mousedown', (ev) => ev.preventDefault());
els.askSel.addEventListener('click', () => {
  els.askSel.hidden = true;
  if (state.selAnchor) focusCompose(state.selAnchor);
});

els.content.addEventListener('click', (ev) => {
  const mark = ev.target.closest('mark.cx-mark');
  if (!mark || !getSelection().isCollapsed) return;
  openSide();
  openThread(mark.dataset.threadId);
});

els.finishBtn.addEventListener('click', async () => {
  els.finishBtn.disabled = true;
  try {
    const { thread } = await api(`/api/units/${encodeURIComponent(state.unitId)}/state`, { state: 'done' });
    els.finishNote.textContent = 'Marked done. zimone will prepare what comes next.';
    if (thread) {
      upsertThread(thread);
      openSide();
      openThread(thread.id);
    }
  } catch (err) {
    reportError(err);
  } finally {
    els.finishBtn.disabled = false;
  }
});

// ---------------------------------------------------------------- live updates

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onopen = () => {
    state.streamLive = true;
    renderConn();
    if (state.wasDown) {
      state.wasDown = false;
      resync();
    }
  };
  es.onerror = () => {
    state.streamLive = false;
    state.wasDown = true;
    renderConn();
  };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'agent') {
      state.agentOnline = msg.online;
      renderConn();
      for (const t of state.threads.values()) {
        if (t.status !== 'queued' && t.status !== 'delivered') continue;
        if (blockBox(t)) renderBlockThread(t);
        else replaceCard(t);
      }
    } else if (msg.type === 'thread' && msg.thread.unit === state.unitId) upsertThread(msg.thread);
    else if (msg.type === 'unit' && msg.id === state.unitId) {
      loadUnit(state.unitId, { preserve: true }).then(() => toast(`zimone updated this ${term('unit')}`), reportError);
    } else if (msg.type === 'workbook' || msg.type === 'unit') resync();
  };
}

function resync() {
  if (state.unitId) loadUnit(state.unitId, { preserve: true }).catch(reportError);
  else if (document.body.classList.contains('cx-toc-view')) loadToc().catch(reportError);
}

const route = location.pathname.match(/^\/u\/([\w-]+)\/?$/);
connectStream();
if (route) loadUnit(route[1]).catch(reportError);
else loadToc().catch(reportError);
