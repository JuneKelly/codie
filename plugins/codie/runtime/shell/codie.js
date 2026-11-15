// codie reader: renders a chapter, anchors questions to passages, and talks to the codie server.

const $ = (id) => document.getElementById(id);
const els = {
  title: $('cx-book-title'),
  conn: $('cx-conn'),
  toggle: $('cx-toggle-side'),
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
  chapterId: null,
  threads: new Map(), // id -> thread
  anchors: new Map(), // thread id -> 'ok' | 'block' | 'chapter' | 'quote-changed' | 'block-missing'
  pendingAnchor: null, // anchor for the ask composer
  selAnchor: null, // anchor for the floating button
  openThread: null, // id of the one expanded thread in the sidebar, or null
  drafts: new Map(), // thread id -> unsent follow-up text (survives collapsing)
  wasDown: false,
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

function setConn(s) {
  els.conn.dataset.state = s;
  els.conn.textContent = { live: 'live', down: 'disconnected', connecting: 'connecting' }[s];
}

// Sidebar state. Wide screens default to open and remember the reader's choice; narrow screens
// show it as an overlay that starts closed. Both classes are set so either layout reads them.
const SIDE_KEY = 'codie.sideClosed';
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
  if (!t.block_id) return 'chapter';
  const block = blockEl(t.block_id);
  if (!block) return 'block-missing';
  if (!t.quote) return 'block';
  const root = anchorRoot(block);
  const start = locate(root, t.quote, t.prefix, t.suffix);
  if (start === -1) return 'quote-changed';
  wrapRange(root, start, start + t.quote.length, t.id);
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
    block_id: block.dataset.blockId,
    quote,
    prefix: text.slice(Math.max(0, start - 40), start),
    suffix: text.slice(start + quote.length, start + quote.length + 40),
    rect: range.getBoundingClientRect(),
  };
}

// ---------------------------------------------------------------- threads

function statusLine(t) {
  if (t.status === 'queued') return el('div', { class: 'cx-status', text: 'Waiting for codie…' });
  if (t.status === 'delivered') return el('div', { class: 'cx-status', text: 'codie is thinking…' });
  return null;
}

function messageEl(m) {
  if (m.role === 'system') return el('div', { class: 'cx-msg cx-msg-system', text: m.text });
  if (m.role === 'codie') {
    return el('div', { class: 'cx-msg cx-msg-codie' }, el('div', { class: 'cx-msg-label', text: 'codie' }), el('div', { html: m.html }));
  }
  const conf = m.confidence ? ` · ${['', 'guessing', 'fairly sure', 'certain'][m.confidence]}` : '';
  return el('div', { class: 'cx-msg' }, conf ? el('div', { class: 'cx-msg-label', text: `Your answer${conf}` }) : null, el('div', { class: 'cx-msg-reader', text: m.text }));
}

// Which replies the reader has seen, per browser: {"<thread id>@<created>": codie reply count}.
// Keyed with the creation time because thread ids restart when a book's server state is reset.
const SEEN_KEY = 'codie.seenReplies';
const threadKey = (t) => `${t.id}@${t.created}`;
const replyCount = (t) => t.messages.filter((m) => m.role === 'codie').length;
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
  const target = els.content.querySelector(`mark[data-thread-id="${t.id}"]`) || (t.block_id && blockEl(t.block_id));
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
  if (t.status === 'delivered') return 'thinking…';
  if (t.kind === 'conversation') return t.messages.length === 1 ? '1 message' : `${t.messages.length} messages`;
  const n = replyCount(t);
  return n === 0 ? 'no reply' : n === 1 ? '1 reply' : `${n} replies`;
}

const ANCHOR_NOTES = {
  'quote-changed': ['passage revised', 'This passage has been revised since you asked.'],
  'block-missing': ['passage removed', 'This passage is no longer in the chapter.'],
};

function threadCard(t) {
  const open = state.openThread === t.id;
  const note = ANCHOR_NOTES[state.anchors.get(t.id)];
  const convo = t.kind === 'conversation';
  // A conversation previews its latest message; a passage thread previews the question that started it.
  const rawPreview = convo ? (t.messages[t.messages.length - 1]?.text ?? '') : (t.messages.find((m) => m.role === 'reader')?.text ?? '');
  // codie's messages are Markdown; show links and emphasis as plain text in the one-line preview.
  const preview = rawPreview.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '');
  const label = convo ? (t.chapter ? 'Conversation about this chapter' : 'Conversation about the book') : (t.quote ?? 'About the whole chapter');
  const head = el(
    'button',
    { type: 'button', class: 'cx-thread-head', 'aria-expanded': String(open), onclick: () => openThread(open ? null : t.id) },
    el('span', { class: t.quote ? 'cx-thread-quote' : 'cx-thread-quote cx-thread-chapter', text: label }),
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
  if (t.quote) body.append(el('blockquote', { class: 'cx-quote', 'data-jump': true, title: 'Show in text', text: t.quote, onclick: () => jumpTo(t) }));
  if (note) body.append(el('div', { class: 'cx-thread-meta cx-detached', text: note[1] }));
  for (const m of t.messages) body.append(messageEl(m));
  const status = statusLine(t);
  if (status) body.append(status);
  if (convo) {
    // The message box at the bottom of the sidebar is this conversation's input.
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
      upsertThread(await api('/api/ask', { thread_id: t.id, question }));
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
  const convo = all.filter((t) => t.kind === 'conversation');
  const asks = all.filter((t) => t.kind === 'ask');
  asks.sort((a, b) => (order.get(a.block_id) ?? -1) - (order.get(b.block_id) ?? -1) || a.created.localeCompare(b.created));
  els.threads.replaceChildren(...[...convo, ...asks].map(threadCard));
  els.empty.hidden = convo.length + asks.length > 0;
  els.empty.textContent = state.chapterId
    ? 'Message codie below, or select a passage to ask about it.'
    : 'Message codie below about the book: what to cover next, how it’s going, anything.';
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
  if (t.kind === 'check') return renderCheck(t);
  if (!prev) state.anchors.set(t.id, applyMark(t));
  const visible = t.id === state.openThread && document.body.classList.contains('cx-side-open');
  if (visible) markSeen(t);
  replaceCard(t);
  if (prev && replyCount(t) > replyCount(prev) && !visible) {
    toast(t.kind === 'conversation' ? 'New message from codie' : 'codie answered', {
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
        upsertThread(await api('/api/answer', { chapter: state.chapterId, check_id: id, response, confidence: Number(picked.value) }));
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

function renderCheck(t) {
  const block = blockEl(t.block_id);
  const box = block?.querySelector('.cx-feedback');
  if (!box) return;
  const status = statusLine(t);
  box.replaceChildren(...t.messages.map(messageEl), ...(status ? [status] : []));
  const form = block.querySelector('.cx-check-form button[type=submit]');
  if (form) form.textContent = t.messages.length ? 'Try again' : 'Submit answer';
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

function renderPager(ch) {
  const side = (c, prev) => {
    if (!c) return el('span');
    if (!c.exists) return el('span', { text: `${prev ? 'Previous' : 'Next'}: ${c.title} (not written yet)` });
    return el('a', { href: `/c/${c.id}`, text: prev ? `← ${c.title}` : `${c.title} →` });
  };
  els.pager.replaceChildren(side(ch.prev, true), side(ch.next, false));
}

async function loadChapter(id, { preserve = false } = {}) {
  const anchor = preserve ? scrollAnchor() : null;
  const drafts = preserve ? checkDrafts() : new Map();
  let book, ch, threads;
  try {
    [book, ch, { threads }] = await Promise.all([api('/api/book'), api(`/api/chapter/${id}`), api(`/api/threads?chapter=${encodeURIComponent(id)}`)]);
  } catch (err) {
    els.banner.hidden = false;
    els.banner.textContent = err.message;
    els.content.replaceChildren();
    els.finish.hidden = true;
    return;
  }
  state.chapterId = id;
  els.composeText.placeholder = composePlaceholder();
  els.title.textContent = book.title;
  document.title = `${ch.title} · ${book.title}`;

  els.banner.hidden = ch.errors.length === 0;
  if (ch.errors.length) {
    els.banner.replaceChildren(
      document.createTextNode('This chapter has formatting errors (codie has been asked to keep chapters valid):'),
      el('ul', {}, ...ch.errors.map((e) => el('li', { text: `line ${e.line}: ${e.message}` }))),
    );
  }

  els.content.innerHTML = ch.html;
  decorateChecks();
  state.threads = new Map(threads.map((t) => [t.id, t]));
  state.anchors = new Map();
  for (const t of threads) {
    if (t.kind === 'check') renderCheck(t);
    else state.anchors.set(t.id, applyMark(t));
  }
  renderThreads();

  for (const [checkId, d] of drafts) {
    const check = blockEl(checkId);
    if (!check) continue;
    if (d.text) check.querySelector('textarea').value = d.text;
    if (d.conf) check.querySelector(`input[value="${d.conf}"]`).checked = true;
  }

  renderPager(ch);
  els.finish.hidden = false;
  els.finishNote.textContent = ch.finished ? 'You marked this chapter finished.' : 'Tells codie to prepare the next chapter based on how this one went.';

  if (anchor) {
    const n = blockEl(anchor.id);
    if (n) window.scrollBy(0, n.getBoundingClientRect().top - anchor.top);
  }
}

async function loadToc() {
  document.body.classList.add('cx-toc-view');
  let book, threads;
  try {
    [book, { threads }] = await Promise.all([api('/api/book'), api('/api/threads?scope=book')]);
  } catch (err) {
    els.banner.hidden = false;
    els.banner.textContent = err.message;
    return;
  }
  els.title.textContent = book.title;
  document.title = book.title;
  const items = book.chapters.map((c) => {
    const tag = c.finished ? el('span', { class: 'cx-tag', text: 'finished' }) : null;
    if (!c.exists) return el('li', { class: 'cx-pending' }, document.createTextNode(c.title), el('span', { class: 'cx-tag', text: 'not written yet' }));
    return el('li', {}, el('a', { href: `/c/${c.id}`, text: c.title }), tag);
  });
  els.content.replaceChildren(
    el('div', { class: 'cx-toc' }, el('h1', { text: book.title }), book.subtitle ? el('p', { class: 'cx-subtitle', text: book.subtitle }) : null, el('h2', { text: 'Contents' }), el('ol', {}, ...items)),
  );
  state.threads = new Map(threads.map((t) => [t.id, t]));
  els.composeText.placeholder = composePlaceholder();
  renderThreads();
}

// ---------------------------------------------------------------- compose

const composePlaceholder = () =>
  state.pendingAnchor ? 'Ask about this passage…' : state.chapterId ? 'Message codie about this chapter…' : 'Message codie about this book…';

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
    // With a passage attached, the message starts its own thread; otherwise it joins the conversation.
    const t = a
      ? await api('/api/ask', { chapter: state.chapterId, block_id: a.block_id, quote: a.quote, prefix: a.prefix, suffix: a.suffix, question: text })
      : await api('/api/message', { chapter: state.chapterId, text });
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
  const a = state.chapterId ? selectionAnchor() : null;
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
    const { thread } = await api('/api/finished', { chapter: state.chapterId });
    els.finishNote.textContent = 'Marked finished. codie will prepare what comes next.';
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
    setConn('live');
    if (state.wasDown) {
      state.wasDown = false;
      resync();
    }
  };
  es.onerror = () => {
    setConn('down');
    state.wasDown = true;
  };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'thread' && msg.thread.chapter === state.chapterId) upsertThread(msg.thread);
    else if (msg.type === 'chapter' && msg.id === state.chapterId) {
      loadChapter(state.chapterId, { preserve: true }).then(() => toast('codie updated this chapter'), reportError);
    } else if (msg.type === 'book' || msg.type === 'chapter') resync();
  };
}

function resync() {
  if (state.chapterId) loadChapter(state.chapterId, { preserve: true }).catch(reportError);
  else if (document.body.classList.contains('cx-toc-view')) loadToc().catch(reportError);
}

const route = location.pathname.match(/^\/c\/([\w-]+)\/?$/);
connectStream();
if (route) loadChapter(route[1]).catch(reportError);
else loadToc().catch(reportError);
