#!/usr/bin/env node
// zimone CLI: serve a workbook, stream user events to the agent, and reply to them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkbookError, detectFolder, loadWorkbook, resolveWorkbookDir, unitExists, unitFile } from '../lib/workbook.mjs';
import { renderUnit } from '../lib/render.mjs';
import { DEFAULT_PORTS, serve, serverInfoFile } from '../lib/server.mjs';

const USAGE = `usage:
  zimone docs    <name>...                  print reference docs for the agent (workbook, planning, serving)
  zimone library <data-dir> [--set <path>]  show or set the workbook library folder
  zimone detect  [folder]                   classify a folder: workbook | brief | empty | other | missing
  zimone serve   <workbook> [--port <n>]    serve the workbook (run in the background); default: first
                                            free port in ${DEFAULT_PORTS[0]}–${DEFAULT_PORTS[1]}
  zimone url     <workbook>                 wait for the workbook's server and print its URL
  zimone watch   <workbook>                 print one ZIMONE_EVENT line per user event (for Monitor)
  zimone reply   <workbook> <event-id>      reply to an event in its thread; Markdown on stdin
  zimone post    <workbook> [--unit <id>]   post to a unit's thread (default: the workbook's);
                                            Markdown on stdin
  zimone ack     <workbook> <event-id>      mark an event handled without replying
  zimone thread  <workbook> <thread-id>     print a thread's history
  zimone check   <workbook> [unit-id]       validate workbook.json and unit files`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`zimone: ${msg}`);
  process.exit(1);
}

function serverBase(dir) {
  const file = serverInfoFile(dir);
  if (!fs.existsSync(file)) throw new Error(`no zimone server is running for ${dir} (${file} is missing); start one with: zimone serve ${path.relative(process.cwd(), dir) || '.'}`);
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
  if (process.stdin.isTTY) throw new Error('message text must be piped on stdin');
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
        console.log(`ZIMONE_EVENT ${JSON.stringify(e)}`);
      }
    } catch (err) {
      failures += 1;
      if (failures >= limit) {
        console.log(`ZIMONE_ERROR zimone server unreachable after ${limit} attempts: ${err.message}`);
        process.exit(1);
      }
    }
    await sleep(1000);
  }
}

function check(dir, only) {
  const wb = loadWorkbook(dir);
  const targets = only ? wb.units.filter((u) => u.id === only) : wb.units;
  if (only && targets.length === 0) throw new WorkbookError(`unit "${only}" is not listed in workbook.json`);
  let errorCount = 0;
  for (const u of targets) {
    const file = unitFile(dir, u.id);
    const rel = path.relative(process.cwd(), file);
    if (!unitExists(dir, u.id)) {
      if (only) {
        console.log(`${rel}: missing`);
        errorCount += 1;
      } else console.log(`${rel}: not written yet`);
      continue;
    }
    const { blocks, errors } = renderUnit(fs.readFileSync(file, 'utf8'));
    for (const e of errors) console.log(`${rel}:${e.line}: ${e.message}`);
    errorCount += errors.length;
    const checks = blocks.filter((b) => b.type === 'check').length;
    const glosses = blocks.filter((b) => b.type === 'gloss').length;
    console.log(`${rel}: ${errors.length ? `${errors.length} error(s)` : 'ok'} — ${blocks.length} blocks, ${checks} checks, ${glosses} glosses`);
  }
  if (errorCount) process.exit(1);
}

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    return;
  }
  if (cmd === 'docs') {
    // Reference docs ship inside the plugin, usually outside the session's folder; printing them
    // through the pre-approved CLI avoids a file-read permission prompt.
    const refDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'reference');
    const names = fs.readdirSync(refDir).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3));
    const wanted = [arg, ...rest].filter(Boolean);
    const unknown = wanted.filter((n) => !names.includes(n));
    if (!wanted.length || unknown.length) fail(`docs needs one or more of: ${names.join(', ')}${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}`);
    process.stdout.write(wanted.map((n) => fs.readFileSync(path.join(refDir, `${n}.md`), 'utf8')).join('\n---\n\n'));
    return;
  }
  if (cmd === 'library') {
    // arg is the plugin data dir (${CLAUDE_PLUGIN_DATA}); config.json there holds {"library": "<abs path>"}.
    if (!arg) fail('library needs the plugin data directory');
    const configFile = path.join(path.resolve(arg), 'config.json');
    const i = rest.indexOf('--set');
    if (i === -1) {
      if (!fs.existsSync(configFile)) {
        console.log('library: unset');
        return;
      }
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (typeof cfg.library !== 'string' || !path.isAbsolute(cfg.library)) fail(`${configFile}: "library" must be an absolute path`);
      console.log(`library: ${cfg.library}`);
      return;
    }
    const raw = rest[i + 1];
    if (!raw) fail('library --set needs a path');
    const lib = path.resolve(raw.replace(/^~(?=$|\/)/, process.env.HOME));
    fs.mkdirSync(lib, { recursive: true });
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    const cfg = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
    fs.writeFileSync(configFile, JSON.stringify({ ...cfg, library: lib }, null, 2) + '\n');
    console.log(`library: ${lib}`);
    return;
  }
  if (cmd === 'detect') {
    const target = path.resolve(arg ?? '.');
    console.log(`${detectFolder(target)} ${target}`);
    return;
  }
  const dir = resolveWorkbookDir(arg);
  switch (cmd) {
    case 'serve': {
      const i = rest.indexOf('--port');
      const port = i === -1 ? null : Number(rest[i + 1]);
      if (port !== null && (!Number.isInteger(port) || port <= 0 || port > 65535)) fail(`invalid --port ${rest[i + 1]}`);
      await serve(dir, { port });
      return;
    }
    case 'url': {
      const file = serverInfoFile(dir);
      for (let waited = 0; !fs.existsSync(file); waited += 200) {
        if (waited >= 10000) fail(`no zimone server came up for ${dir} within 10s (${file} is missing)`);
        await sleep(200);
      }
      console.log(`${serverBase(dir)}/`);
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
    case 'post': {
      const i = rest.indexOf('--unit');
      const unit = i === -1 ? null : rest[i + 1];
      if (i !== -1 && !unit) fail('--unit needs a unit id');
      const text = await readStdin();
      if (!text) fail('message text on stdin is empty');
      const r = await call(dir, 'POST', '/api/post', { unit, text });
      console.log(`posted to ${unit ? `unit ${unit}` : 'the workbook'}'s thread (thread ${r.thread_id})`);
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
      const t = await call(dir, 'GET', `/api/threads/${threadId}`);
      const where = t.unit ? `unit ${t.unit}${t.anchor ? `, block #${t.anchor.block}` : ''}` : 'the workbook';
      console.log(`thread ${t.id} — ${where} — ${t.status}`);
      if (t.anchor?.quote) console.log(`quote: "${t.anchor.quote}"`);
      for (const m of t.messages) {
        const fields = m.fields ? ` ${JSON.stringify(m.fields)}` : '';
        const body = m.notice ? `[${m.notice.type}: ${m.notice.state}]` : m.text;
        console.log(`\n${m.role}${fields} @ ${m.at}:\n${body}`);
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
