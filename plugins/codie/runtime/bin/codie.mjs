#!/usr/bin/env node
// codie CLI: serve a book, stream reader events to the agent, and reply to them.
import fs from 'node:fs';
import path from 'node:path';
import { BookError, chapterExists, chapterFile, loadBook, resolveBookDir } from '../lib/book.mjs';
import { renderChapter } from '../lib/render.mjs';
import { serve, serverInfoFile } from '../lib/server.mjs';

const USAGE = `usage:
  codie serve  <book> [--port 4317]   serve the book (run in the background)
  codie watch  <book>                 print one CODIE_EVENT line per reader event (for Monitor)
  codie reply  <book> <event-id>      reply to an ask/check event; reply Markdown on stdin
  codie ack    <book> <event-id>      mark an event handled without replying
  codie thread <book> <thread-id>     print a thread's history
  codie check  <book> [chapter-id]    validate book.json and chapter files`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`codie: ${msg}`);
  process.exit(1);
}

function serverBase(dir) {
  const file = serverInfoFile(dir);
  if (!fs.existsSync(file)) throw new Error(`no codie server is running for ${dir} (${file} is missing); start one with: codie serve ${path.relative(process.cwd(), dir) || '.'}`);
  const { port } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return `http://127.0.0.1:${port}`;
}

async function call(dir, method, route, body) {
  const res = await fetch(serverBase(dir) + route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${data.error}`);
  return data;
}

async function readStdin() {
  if (process.stdin.isTTY) throw new Error('reply text must be piped on stdin');
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function watch(dir) {
  // Tolerate the server still starting up, then treat sustained failure as fatal.
  let failures = 0;
  const limit = 10;
  let seen = new Set();
  let instance = null;
  for (;;) {
    try {
      const res = await call(dir, 'POST', '/api/events/claim', {});
      failures = 0;
      // A restarted server may reuse event ids; forget what this watcher printed for the old one.
      if (res.instance !== instance) {
        instance = res.instance;
        seen = new Set();
      }
      const { events } = res;
      for (const e of events) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        console.log(`CODIE_EVENT ${JSON.stringify(e)}`);
      }
    } catch (err) {
      failures += 1;
      if (failures >= limit) {
        console.log(`CODIE_ERROR codie server unreachable after ${limit} attempts: ${err.message}`);
        process.exit(1);
      }
    }
    await sleep(1000);
  }
}

function check(dir, only) {
  const book = loadBook(dir);
  const targets = only ? book.chapters.filter((c) => c.id === only) : book.chapters;
  if (only && targets.length === 0) throw new BookError(`chapter "${only}" is not listed in book.json`);
  let errorCount = 0;
  for (const c of targets) {
    const file = chapterFile(dir, c.id);
    const rel = path.relative(process.cwd(), file);
    if (!chapterExists(dir, c.id)) {
      if (only) {
        console.log(`${rel}: missing`);
        errorCount += 1;
      } else console.log(`${rel}: not written yet`);
      continue;
    }
    const { blocks, errors } = renderChapter(fs.readFileSync(file, 'utf8'));
    for (const e of errors) console.log(`${rel}:${e.line}: ${e.message}`);
    errorCount += errors.length;
    const checks = blocks.filter((b) => b.type === 'check').length;
    const glosses = blocks.filter((b) => b.type === 'gloss').length;
    console.log(`${rel}: ${errors.length ? `${errors.length} error(s)` : 'ok'} — ${blocks.length} blocks, ${checks} checks, ${glosses} glosses`);
  }
  if (errorCount) process.exit(1);
}

async function main() {
  const [cmd, bookArg, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    return;
  }
  const dir = resolveBookDir(bookArg);
  switch (cmd) {
    case 'serve': {
      const i = rest.indexOf('--port');
      const port = i === -1 ? 4317 : Number(rest[i + 1]);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) fail(`invalid --port ${rest[i + 1]}`);
      await serve(dir, { port });
      return;
    }
    case 'watch':
      return watch(dir);
    case 'reply': {
      const [eventId] = rest;
      if (!eventId) fail('reply needs an <event-id>');
      const text = await readStdin();
      if (!text) fail('reply text on stdin is empty');
      const r = await call(dir, 'POST', '/api/reply', { event_id: eventId, text });
      console.log(`replied to ${eventId} in thread ${r.thread_id}`);
      return;
    }
    case 'ack': {
      const [eventId] = rest;
      if (!eventId) fail('ack needs an <event-id>');
      await call(dir, 'POST', '/api/ack', { event_id: eventId });
      console.log(`acknowledged ${eventId}`);
      return;
    }
    case 'thread': {
      const [threadId] = rest;
      if (!threadId) fail('thread needs a <thread-id>');
      const t = await call(dir, 'GET', `/api/thread/${threadId}`);
      console.log(`thread ${t.id} (${t.kind}) — chapter ${t.chapter}${t.block_id ? `, block #${t.block_id}` : ''} — ${t.status}`);
      if (t.quote) console.log(`quote: "${t.quote}"`);
      for (const m of t.messages) {
        const conf = m.confidence ? ` [confidence ${m.confidence}/3]` : '';
        console.log(`\n${m.role}${conf} @ ${m.at}:\n${m.text}`);
      }
      return;
    }
    case 'check':
      return check(dir, rest[0]);
    default:
      fail(`unknown command "${cmd}"\n${USAGE}`);
  }
}

main().catch((err) => fail(err.message));
