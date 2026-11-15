import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbookError, loadWorkbook, readUnit, unitExists } from './workbook.mjs';
import { renderMarkdown, validateFields } from './render.mjs';

const SHELL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shell');
const MAX_BODY = 1 << 20;
const STATE_VERSION = 2;
// What the user can mark a unit as. Extend here (and in the page) to add states.
const UNIT_STATES = ['done'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function serverInfoFile(dir) {
  return path.join(dir, '.zimone', 'server.json');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Persistent user/agent state: threads, the event queue and unit progress.
class Store {
  constructor(file) {
    this.file = file;
    if (fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        throw new Error(`cannot parse ${file}: ${err.message}`, { cause: err });
      }
      if (this.data.version !== STATE_VERSION) {
        throw new Error(`${file}: state version ${this.data.version} is from another zimone version (this one uses ${STATE_VERSION}); move the .zimone folder aside to start with empty state`);
      }
    } else {
      this.data = { version: STATE_VERSION, seq: 0, threads: {}, events: [], progress: {} };
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
      messages: t.messages.map((m) => (m.role === 'agent' ? { ...m, html: renderMarkdown(m.text) } : m)),
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

export const DEFAULT_PORTS = [4317, 4336]; // inclusive range tried when no --port is given

// Serves a workbook. port: a number to bind exactly, or null to take the first free port in DEFAULT_PORTS.
export async function serve(dir, { port }) {
  const zimoneDir = path.join(dir, '.zimone');
  fs.mkdirSync(zimoneDir, { recursive: true });
  const infoFile = serverInfoFile(dir);
  if (fs.existsSync(infoFile)) {
    const prev = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    if (pidAlive(prev.pid)) throw new Error(`a zimone server is already running for this workbook (pid ${prev.pid}, port ${prev.port})`);
    console.error(`removing stale ${infoFile} (pid ${prev.pid} is gone)`);
  }
  loadWorkbook(dir); // fail fast on an invalid workbook.json
  const store = new Store(path.join(zimoneDir, 'state.json'));
  // Identifies this server run; event ids can repeat if state.json is reset, so watchers key on it.
  const instance = crypto.randomUUID();
  const clients = new Set();
  let allowedHosts = new Set(); // set once the port is bound

  const broadcast = (msg) => {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(line);
  };
  const broadcastThread = (t) => broadcast({ type: 'thread', thread: store.publicThread(t) });

  // Whether a session is watching: `zimone watch` claims every second, so a gap means it stopped.
  const AGENT_TIMEOUT_MS = 5000;
  let lastClaim = 0;
  let agentOnline = false;
  const agentMessage = () => ({ type: 'agent', online: agentOnline });
  const setAgentOnline = (online) => {
    if (online === agentOnline) return;
    agentOnline = online;
    broadcast(agentMessage());
  };

  const unitOrThrow = (id) => {
    try {
      return readUnit(dir, id);
    } catch (err) {
      if (err instanceof WorkbookError) throw new HttpError(404, err.message);
      throw err;
    }
  };
  const listedUnitOrThrow = (id) => {
    if (!loadWorkbook(dir).units.some((u) => u.id === id)) throw new HttpError(404, `unit "${id}" is not listed in workbook.json`);
  };

  const newEvent = (type, threadId) => {
    const e = { id: store.nextId('e'), type, thread_id: threadId, created: new Date().toISOString(), delivered_at: null, handled_at: null, payload: null };
    store.data.events.push(e);
    return e;
  };

  const newThread = (unit, anchor) => {
    const t = { id: store.nextId('t'), unit, anchor, created: new Date().toISOString(), messages: [] };
    store.data.threads[t.id] = t;
    return t;
  };

  // The one thread about a whole unit (or, with unit null, the whole workbook).
  const scopeThread = (unit) => {
    if (unit !== null) listedUnitOrThrow(unit);
    return Object.values(store.data.threads).find((t) => t.unit === unit && t.anchor === null) ?? newThread(unit, null);
  };

  // The anchored block as the unit stands now, or null for an unanchored thread.
  const anchoredBlock = (t) => {
    if (!t.anchor) return null;
    const block = unitOrThrow(t.unit).blocks.find((b) => b.id === t.anchor.block);
    if (!block) throw new HttpError(409, `block #${t.anchor.block} is no longer in unit ${t.unit}`);
    return block;
  };

  // Finds or creates the thread a new message goes to. An anchor with a quote (a passage) always
  // starts a new thread; a whole-block anchor, or none, has exactly one thread.
  const threadForPost = (body) => {
    const threadId = str(body, 'thread_id', { optional: true });
    if (threadId) {
      if (body.unit !== undefined || body.anchor !== undefined) throw new HttpError(400, 'give "thread_id" or "unit"/"anchor", not both');
      return store.thread(threadId);
    }
    const unit = str(body, 'unit', { optional: true });
    const a = body.anchor;
    if (a === undefined || a === null) return scopeThread(unit);
    if (typeof a !== 'object' || Array.isArray(a)) throw new HttpError(400, '"anchor" must be an object');
    if (unit === null) throw new HttpError(400, 'an anchored message needs a "unit"');
    const block = str(a, 'block');
    if (!unitOrThrow(unit).blocks.some((b) => b.id === block)) throw new HttpError(400, `unit ${unit} has no block #${block}`);
    const quote = str(a, 'quote', { optional: true });
    if (quote) {
      return newThread(unit, { block, quote, prefix: str(a, 'prefix', { optional: true }) ?? '', suffix: str(a, 'suffix', { optional: true }) ?? '' });
    }
    return (
      Object.values(store.data.threads).find((t) => t.unit === unit && t.anchor && t.anchor.block === block && t.anchor.quote === null) ??
      newThread(unit, { block, quote: null, prefix: '', suffix: '' })
    );
  };

  const routes = {
    'GET /api/workbook': () => {
      const wb = loadWorkbook(dir);
      return { ...wb, units: wb.units.map((u) => ({ ...u, exists: unitExists(dir, u.id), state: store.data.progress[u.id]?.state ?? null })) };
    },
    'GET /api/units/:id': (_req, { id }) => {
      const { blocks, ...unit } = unitOrThrow(id);
      return { ...unit, state: store.data.progress[id]?.state ?? null };
    },
    // ?unit=<id> for a unit's threads; ?unit= (empty) for the workbook's.
    'GET /api/threads': (_req, _p, query) => {
      if (!query.has('unit')) throw new HttpError(400, '"unit" query parameter is required (empty for the workbook)');
      const unit = query.get('unit') || null;
      return { threads: Object.values(store.data.threads).filter((t) => t.unit === unit).map((t) => store.publicThread(t)) };
    },
    'GET /api/threads/:id': (_req, { id }) => store.publicThread(store.thread(id)),

    // Everything the user says: a new or follow-up message in some thread.
    'POST /api/messages': (body) => {
      const text = str(body, 'text');
      const thread = threadForPost(body);
      const block = anchoredBlock(thread);
      let fields;
      try {
        fields = validateFields(thread.anchor && !thread.anchor.quote ? block.type : null, body.fields);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      thread.messages.push({ role: 'user', text, ...(fields ? { fields } : {}), at: new Date().toISOString() });
      const e = newEvent('message', thread.id);
      // Short fields first, long text last: Monitor notifications may truncate long lines.
      e.payload = {
        id: e.id,
        type: 'message',
        thread_id: thread.id,
        unit: thread.unit,
        block: block?.id ?? null,
        block_type: block?.type ?? null,
        block_attrs: block?.attrs ?? null,
        turn: thread.messages.filter((m) => m.role === 'user').length,
        fields,
        text,
        quote: thread.anchor?.quote ?? null,
      };
      store.save();
      broadcastThread(thread);
      return store.publicThread(thread);
    },

    'POST /api/units/:id/state': (body, { id }) => {
      const state = str(body, 'state');
      if (!UNIT_STATES.includes(state)) throw new HttpError(400, `"state" must be one of: ${UNIT_STATES.join(', ')}`);
      unitOrThrow(id);
      const wb = loadWorkbook(dir);
      const next = wb.units[wb.units.findIndex((u) => u.id === id) + 1] ?? null;
      store.data.progress[id] = { state, at: new Date().toISOString() };
      const pending = store.data.events.some((e) => e.type === 'unit_state' && !e.handled_at && e.payload.unit === id && e.payload.state === state);
      let thread = null;
      if (!pending) {
        // The change shows in the unit's thread, where the agent answers when it has acted on it.
        thread = scopeThread(id);
        thread.messages.push({ role: 'system', notice: { type: 'unit_state', state, next_unit: next?.id ?? null }, at: new Date().toISOString() });
        const e = newEvent('unit_state', thread.id);
        e.payload = { id: e.id, type: 'unit_state', thread_id: thread.id, unit: id, state, next_unit: next?.id ?? null, next_exists: next ? unitExists(dir, next.id) : false };
        broadcastThread(thread);
      }
      store.save();
      broadcast({ type: 'workbook' });
      return { ok: true, thread: thread && store.publicThread(thread) };
    },

    // Agent side ------------------------------------------------------------
    'POST /api/events/claim': () => {
      lastClaim = Date.now();
      setAgentOnline(true);
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
      t.messages.push({ role: 'agent', text, at, event_id: e.id });
      e.handled_at = at;
      store.save();
      broadcastThread(t);
      return { ok: true, thread_id: t.id };
    },
    // Agent-initiated message to a unit's thread, or the workbook's (no event involved).
    'POST /api/post': (body) => {
      const text = str(body, 'text');
      const thread = scopeThread(str(body, 'unit', { optional: true }));
      thread.messages.push({ role: 'agent', text, at: new Date().toISOString() });
      store.save();
      broadcastThread(thread);
      return { ok: true, thread_id: thread.id };
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

      if (req.method === 'GET' && (p === '/' || /^\/u\/[\w-]+\/?$/.test(p))) return sendFile(res, path.join(SHELL_DIR, 'index.html'), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/shell/zimone.js') return sendFile(res, path.join(SHELL_DIR, 'zimone.js'), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && p === '/shell/zimone.css') return sendFile(res, path.join(SHELL_DIR, 'zimone.css'), 'text/css; charset=utf-8');
      if (req.method === 'GET' && p === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        res.write(`data: ${JSON.stringify(agentMessage())}\n\n`);
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
      if (err instanceof WorkbookError) return sendJson(res, 500, { error: err.message });
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
    if (rel.startsWith('.zimone/')) return;
    const m = rel.match(/^units\/([\w-]+)\.md$/);
    if (m) notify(`u:${m[1]}`, { type: 'unit', id: m[1] });
    else if (rel === 'workbook.json') notify('workbook', { type: 'workbook' });
  });

  const keepalive = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25000);
  const agentCheck = setInterval(() => {
    if (agentOnline && Date.now() - lastClaim > AGENT_TIMEOUT_MS) setAgentOnline(false);
  }, 1000);

  const listen = (p) =>
    new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    });
  const candidates = [];
  if (port !== null) candidates.push(port);
  else for (let p = DEFAULT_PORTS[0]; p <= DEFAULT_PORTS[1]; p++) candidates.push(p);
  let bound = null;
  for (const p of candidates) {
    try {
      await listen(p);
      bound = p;
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  if (bound === null) {
    throw new Error(port !== null ? `port ${port} is already in use; pass --port <n> to pick another` : `no free port in ${DEFAULT_PORTS[0]}–${DEFAULT_PORTS[1]}; pass --port <n>`);
  }
  port = bound;
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  fs.writeFileSync(infoFile, JSON.stringify({ port, pid: process.pid, started: new Date().toISOString() }, null, 2));
  const shutdown = () => {
    if (fs.existsSync(infoFile) && JSON.parse(fs.readFileSync(infoFile, 'utf8')).pid === process.pid) fs.unlinkSync(infoFile);
    clearInterval(keepalive);
    clearInterval(agentCheck);
    watcher.close();
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`zimone serving ${path.relative(process.cwd(), dir) || "."} at http://127.0.0.1:${port}/`);
}
