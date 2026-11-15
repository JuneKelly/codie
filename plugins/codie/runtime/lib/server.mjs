import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BookError, chapterExists, loadBook, readChapter } from './book.mjs';
import { renderMarkdown } from './render.mjs';

const SHELL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shell');
const MAX_BODY = 1 << 20;
const CONFIDENCE_LABELS = { 1: 'guessing', 2: 'fairly sure', 3: 'certain' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function serverInfoFile(dir) {
  return path.join(dir, '.codie', 'server.json');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Persistent reader/agent state: threads and the event queue.
class Store {
  constructor(file) {
    this.file = file;
    if (fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        throw new Error(`cannot parse ${file}: ${err.message}`, { cause: err });
      }
      if (this.data.version !== 1) throw new Error(`${file}: unsupported state version ${this.data.version}`);
    } else {
      this.data = { version: 1, seq: 0, threads: {}, events: [], finished: {} };
    }
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  nextId(prefix) {
    this.data.seq += 1;
    return `${prefix}${this.data.seq}`;
  }
  event(id) {
    const e = this.data.events.find((x) => x.id === id);
    if (!e) throw new HttpError(404, `no event ${id}`);
    return e;
  }
  thread(id) {
    const t = this.data.threads[id];
    if (!t) throw new HttpError(404, `no thread ${id}`);
    return t;
  }
  threadStatus(t) {
    const open = this.data.events.filter((e) => e.thread_id === t.id && !e.handled_at);
    if (open.length === 0) return 'answered';
    return open.some((e) => e.delivered_at) ? 'delivered' : 'queued';
  }
  publicThread(t) {
    return {
      ...t,
      status: this.threadStatus(t),
      messages: t.messages.map((m) => (m.role === 'codie' ? { ...m, html: renderMarkdown(m.text) } : m)),
    };
  }
}

function str(body, key, { optional = false } = {}) {
  const v = body[key];
  if (v === undefined || v === null) {
    if (optional) return null;
    throw new HttpError(400, `"${key}" is required`);
  }
  if (typeof v !== 'string') throw new HttpError(400, `"${key}" must be a string`);
  if (!optional && !v.trim()) throw new HttpError(400, `"${key}" must not be empty`);
  return v;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object');
        resolve(parsed);
      } catch (err) {
        reject(new HttpError(400, `invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

export async function serve(dir, { port }) {
  const codieDir = path.join(dir, '.codie');
  fs.mkdirSync(codieDir, { recursive: true });
  const infoFile = serverInfoFile(dir);
  if (fs.existsSync(infoFile)) {
    const prev = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    if (pidAlive(prev.pid)) throw new Error(`a codie server is already running for this book (pid ${prev.pid}, port ${prev.port})`);
    console.error(`removing stale ${infoFile} (pid ${prev.pid} is gone)`);
  }
  loadBook(dir); // fail fast on an invalid book.json
  const store = new Store(path.join(codieDir, 'state.json'));
  // Identifies this server run; event ids can repeat if state.json is reset, so watchers key on it.
  const instance = crypto.randomUUID();
  const clients = new Set();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const broadcast = (msg) => {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(line);
  };
  const broadcastThread = (t) => broadcast({ type: 'thread', thread: store.publicThread(t) });

  const chapterOrThrow = (id) => {
    try {
      return readChapter(dir, id);
    } catch (err) {
      if (err instanceof BookError) throw new HttpError(404, err.message);
      throw err;
    }
  };

  const newEvent = (type, threadId, payload) => {
    const e = { id: store.nextId('e'), type, thread_id: threadId, created: new Date().toISOString(), delivered_at: null, handled_at: null, payload };
    store.data.events.push(e);
    return e;
  };

  const routes = {
    'GET /api/book': () => {
      const book = loadBook(dir);
      return {
        ...book,
        chapters: book.chapters.map((c) => ({ ...c, exists: chapterExists(dir, c.id), finished: Boolean(store.data.finished[c.id]) })),
      };
    },
    'GET /api/chapter/:id': (_req, { id }) => {
      const { blocks, ...ch } = chapterOrThrow(id);
      return { ...ch, finished: Boolean(store.data.finished[id]) };
    },
    'GET /api/threads': (_req, _p, query) => {
      const chapter = query.get('chapter');
      if (!chapter) throw new HttpError(400, '"chapter" query parameter is required');
      return { threads: Object.values(store.data.threads).filter((t) => t.chapter === chapter).map((t) => store.publicThread(t)) };
    },
    'GET /api/thread/:id': (_req, { id }) => store.publicThread(store.thread(id)),

    'POST /api/ask': (body) => {
      const question = str(body, 'question');
      const threadId = str(body, 'thread_id', { optional: true });
      let thread;
      if (threadId) {
        thread = store.thread(threadId);
        if (thread.kind !== 'ask') throw new HttpError(400, `thread ${threadId} is a ${thread.kind} thread`);
      } else {
        const chapter = str(body, 'chapter');
        const ch = chapterOrThrow(chapter);
        const blockId = str(body, 'block_id', { optional: true });
        if (blockId && !ch.blocks.some((b) => b.id === blockId)) throw new HttpError(400, `chapter ${chapter} has no block #${blockId}`);
        const quote = blockId ? str(body, 'quote', { optional: true }) : null;
        thread = {
          id: store.nextId('t'),
          kind: 'ask',
          chapter,
          block_id: blockId,
          quote,
          prefix: quote ? (str(body, 'prefix', { optional: true }) ?? '') : '',
          suffix: quote ? (str(body, 'suffix', { optional: true }) ?? '') : '',
          created: new Date().toISOString(),
          messages: [],
        };
        store.data.threads[thread.id] = thread;
      }
      thread.messages.push({ role: 'reader', text: question, at: new Date().toISOString() });
      const e = newEvent('ask', thread.id, null);
      // Short fields first, long text last: Monitor notifications may truncate long lines.
      e.payload = {
        id: e.id,
        type: 'ask',
        thread_id: thread.id,
        chapter: thread.chapter,
        block_id: thread.block_id,
        follow_up: thread.messages.length > 1,
        question,
        quote: thread.quote,
      };
      store.save();
      broadcastThread(thread);
      return store.publicThread(thread);
    },

    'POST /api/answer': (body) => {
      const chapter = str(body, 'chapter');
      const checkId = str(body, 'check_id');
      const response = str(body, 'response');
      const confidence = body.confidence;
      if (![1, 2, 3].includes(confidence)) throw new HttpError(400, '"confidence" must be 1, 2 or 3');
      const ch = chapterOrThrow(chapter);
      const block = ch.blocks.find((b) => b.id === checkId);
      if (!block || block.type !== 'check') throw new HttpError(400, `chapter ${chapter} has no check #${checkId}`);
      let thread = Object.values(store.data.threads).find((t) => t.kind === 'check' && t.chapter === chapter && t.block_id === checkId);
      if (!thread) {
        thread = { id: store.nextId('t'), kind: 'check', chapter, block_id: checkId, quote: null, prefix: '', suffix: '', created: new Date().toISOString(), messages: [] };
        store.data.threads[thread.id] = thread;
      }
      thread.messages.push({ role: 'reader', text: response, confidence, at: new Date().toISOString() });
      const e = newEvent('check_answer', thread.id, null);
      e.payload = {
        id: e.id,
        type: 'check_answer',
        thread_id: thread.id,
        chapter,
        check_id: checkId,
        objective: block.objective ?? null,
        attempt: thread.messages.filter((m) => m.role === 'reader').length,
        confidence,
        confidence_label: CONFIDENCE_LABELS[confidence],
        response,
      };
      store.save();
      broadcastThread(thread);
      return store.publicThread(thread);
    },

    'POST /api/finished': (body) => {
      const chapter = str(body, 'chapter');
      chapterOrThrow(chapter);
      const book = loadBook(dir);
      const idx = book.chapters.findIndex((c) => c.id === chapter);
      const next = book.chapters[idx + 1] ?? null;
      store.data.finished[chapter] = new Date().toISOString();
      const pending = store.data.events.some((e) => e.type === 'chapter_finished' && !e.handled_at && e.payload.chapter === chapter);
      if (!pending) {
        const e = newEvent('chapter_finished', null, null);
        e.payload = { id: e.id, type: 'chapter_finished', chapter, next_chapter: next?.id ?? null, next_exists: next ? chapterExists(dir, next.id) : false };
      }
      store.save();
      broadcast({ type: 'book' });
      return { ok: true };
    },

    // Agent side ------------------------------------------------------------
    'POST /api/events/claim': () => {
      const now = new Date().toISOString();
      const out = [];
      const touched = new Set();
      for (const e of store.data.events) {
        if (e.handled_at) continue;
        out.push({ ...e.payload, redelivered: Boolean(e.delivered_at) });
        if (!e.delivered_at) {
          e.delivered_at = now;
          if (e.thread_id) touched.add(e.thread_id);
        }
      }
      if (touched.size || out.length) store.save();
      for (const id of touched) broadcastThread(store.thread(id));
      return { instance, events: out };
    },
    'POST /api/reply': (body) => {
      const e = store.event(str(body, 'event_id'));
      const text = str(body, 'text');
      if (e.handled_at) throw new HttpError(409, `event ${e.id} was already handled at ${e.handled_at}`);
      if (!e.thread_id) throw new HttpError(400, `event ${e.id} (${e.type}) has no thread to reply to; use ack`);
      const t = store.thread(e.thread_id);
      const at = new Date().toISOString();
      t.messages.push({ role: 'codie', text, at, event_id: e.id });
      e.handled_at = at;
      store.save();
      broadcastThread(t);
      return { ok: true, thread_id: t.id };
    },
    'POST /api/ack': (body) => {
      const e = store.event(str(body, 'event_id'));
      if (e.handled_at) throw new HttpError(409, `event ${e.id} was already handled at ${e.handled_at}`);
      e.handled_at = new Date().toISOString();
      store.save();
      if (e.thread_id) broadcastThread(store.thread(e.thread_id));
      return { ok: true };
    },
  };

  const compiled = Object.entries(routes).map(([key, fn]) => {
    const [method, pattern] = key.split(' ');
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[\\w-]+)')}$`);
    return { method, re, fn };
  });

  const sendJson = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const sendFile = (res, file, type) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host)) throw new HttpError(403, 'unexpected Host header');
      const url = new URL(req.url, `http://${req.headers.host}`);
      const p = url.pathname;

      if (req.method === 'GET' && (p === '/' || /^\/c\/[\w-]+\/?$/.test(p))) return sendFile(res, path.join(SHELL_DIR, 'index.html'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/shell/codie.js') return sendFile(res, path.join(SHELL_DIR, 'codie.js'), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && p === '/shell/codie.css') return sendFile(res, path.join(SHELL_DIR, 'codie.css'), 'text/css; charset=utf-8');
      if (req.method === 'GET' && p === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      const route = compiled.find((r) => r.method === req.method && r.re.test(p));
      if (!route) throw new HttpError(404, `no route for ${req.method} ${p}`);
      let body = null;
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !allowedHosts.has(origin.replace(/^http:\/\//, ''))) throw new HttpError(403, `cross-origin request from ${origin} rejected`);
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
        body = await readBody(req);
      }
      const params = p.match(route.re).groups ?? {};
      const result = req.method === 'POST' ? route.fn(body, params) : route.fn(req, params, url.searchParams);
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      if (err instanceof BookError) return sendJson(res, 500, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: `internal error: ${err.message}` });
    }
  });

  // Push file changes to open pages.
  const timers = new Map();
  const notify = (key, msg) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => broadcast(msg), 150));
  };
  const watcher = fs.watch(dir, { recursive: true }, (_ev, filename) => {
    if (!filename) return;
    const rel = filename.split(path.sep).join('/');
    if (rel.startsWith('.codie/')) return;
    const m = rel.match(/^chapters\/([\w-]+)\.md$/);
    if (m) notify(`c:${m[1]}`, { type: 'chapter', id: m[1] });
    else if (rel === 'book.json') notify('book', { type: 'book' });
  });

  const keepalive = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25000);

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') reject(new Error(`port ${port} is already in use; pass --port <n> to pick another`));
      else reject(err);
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  fs.writeFileSync(infoFile, JSON.stringify({ port, pid: process.pid, started: new Date().toISOString() }, null, 2));
  const shutdown = () => {
    if (fs.existsSync(infoFile) && JSON.parse(fs.readFileSync(infoFile, 'utf8')).pid === process.pid) fs.unlinkSync(infoFile);
    clearInterval(keepalive);
    watcher.close();
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`codie serving ${path.relative(process.cwd(), dir) || "."} at http://127.0.0.1:${port}/`);
}
