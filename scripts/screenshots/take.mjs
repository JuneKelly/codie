// Retakes the README screenshots in docs/screenshots/ from a scratch copy of examples/demo.
//
//   node scripts/screenshots/take.mjs
//
// Needs Google Chrome (set CHROME to its binary if it isn't at the macOS default). The script serves
// the copy on a free port, seeds it with reader activity, keeps a watcher claiming so the page shows
// a live session, and drives headless Chrome over the DevTools protocol at 1280x800, 2x scale.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'plugins/zimone/runtime/bin/zimone.mjs');
const OUT = path.join(ROOT, 'docs/screenshots');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHOTS = [
  {
    name: 'reader',
    path: '/c/01-snapshots',
    // Open the SHA-1 question and scroll the sidebar so its card starts at the top.
    setup: `
      [...document.querySelectorAll('.cx-thread-head')].find((b) => b.textContent.includes('SHA-1 hash')).click();
      await sleep(800);
      const card = document.querySelector('.cx-thread[data-open="true"]');
      const s = card.closest('.cx-side-scroll');
      s.style.scrollBehavior = 'auto';
      s.scrollTop += card.getBoundingClientRect().top - s.getBoundingClientRect().top - 8;`,
  },
  {
    name: 'checks',
    path: '/c/01-snapshots',
    setup: `
      document.querySelector('[data-block-id="c1-chk1"]').scrollIntoView({ block: 'start' });
      window.scrollBy(0, -110);
      [...document.querySelectorAll('.cx-thread-head')].find((b) => b.textContent.includes('Conversation about this chapter')).click();`,
  },
  { name: 'contents', path: '/', setup: `document.querySelector('.cx-thread-head').click();` },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zimone-shots-'));

function start(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], ...opts });
  children.push(child);
  return child;
}

async function devtools() {
  const chrome = start(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(scratch, 'chrome')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
  ]);
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on('error', reject);
    chrome.on('exit', (code) => reject(new Error(`chrome exited (${code}): ${buf}`)));
  });
  const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
    else p.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => ws.close() };
}

try {
  const book = path.join(scratch, 'book');
  fs.cpSync(path.join(ROOT, 'examples/demo'), book, { recursive: true });
  const server = start(process.execPath, [CLI, 'serve', book]);
  let serverErr = '';
  server.stderr.on('data', (d) => (serverErr += d));
  server.on('exit', (code) => code && console.error(`server exited (${code}): ${serverErr}`));
  const base = execFileSync(process.execPath, [CLI, 'url', book], { encoding: 'utf8' }).trim().replace(/\/$/, '');
  await seed(base);
  start(process.execPath, [CLI, 'watch', book]); // keeps the page's "live" indicator on
  await sleep(1500);

  const { send, close } = await devtools();
  try {
    for (const shot of SHOTS) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await send('Page.navigate', { url: base + shot.path });
      await sleep(1200);
      const r = await send('Runtime.evaluate', {
        expression: `(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${shot.setup} })()`,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(`${shot.name}: ${JSON.stringify(r.exceptionDetails)}`);
      await sleep(500);
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `${shot.name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      console.log(path.relative(ROOT, file));
    }
  } finally {
    close();
  }
} finally {
  for (const c of children) c.kill();
  await sleep(300);
  fs.rmSync(scratch, { recursive: true, force: true });
}
