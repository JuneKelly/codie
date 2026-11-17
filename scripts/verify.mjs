#!/usr/bin/env node
// Runs the automatable checks that match what changed in this repo, and lists the manual ones
// still owed. See .claude/skills/verify/SKILL.md and docs/TESTING.md.
//
//   node scripts/verify.mjs          # changed = uncommitted + untracked + unpushed
//
// Exit status is 1 if any check failed. Manual checks are listed, never counted as passed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CLI = 'plugins/zimone/runtime/bin/zimone.mjs';
const DEMO = 'examples/demo';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  if (r.error) throw new Error(`cannot run ${cmd}: ${r.error.message}`);
  return r;
}

function git(...args) {
  const r = run('git', args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

const notes = [];
const lines = (s) => s.split('\n').filter(Boolean);

// What changed.
const changed = new Set([...lines(git('diff', '--name-only', 'HEAD')), ...lines(git('ls-files', '--others', '--exclude-standard'))]);
const up = run('git', ['rev-parse', '--verify', '--quiet', '@{u}']);
const upstream = up.status === 0 ? up.stdout.trim() : null;
if (upstream) {
  for (const f of lines(git('diff', '--name-only', `${upstream}..HEAD`))) changed.add(f);
} else {
  notes.push('no upstream branch: unpushed commits are not included in the change set');
}
const baseRef = upstream ?? 'HEAD';

const files = [...changed].sort();
const touches = (...prefixes) => files.some((f) => prefixes.some((p) => f === p || f.startsWith(p)));

console.log(`Change set (${files.length} files), baseline ${upstream ? '@{u}' : 'HEAD'}:`);
for (const f of files) console.log(`  ${f}`);
console.log();

const ran = [];
const failed = [];
const manual = new Set();

function check(name, fn) {
  let result;
  try {
    result = fn();
  } catch (err) {
    result = { ok: false, detail: err.message };
  }
  if (result.ok) {
    ran.push(name);
    console.log(`PASS  ${name}`);
  } else {
    failed.push({ name, detail: result.detail });
    console.log(`FAIL  ${name}\n${result.detail.replace(/^/gm, '      ')}`);
  }
}

function command(cmd, args) {
  const r = run(cmd, args);
  return { ok: r.status === 0, detail: (r.stdout + r.stderr).trim() };
}

// Renderer stability: baseline vs working-tree HTML for every unit in examples/demo.
async function rendererStability() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zimone-verify-'));
  try {
    const tar = run('sh', ['-c', `git archive ${baseRef} plugins/zimone/runtime | tar -x -C "${tmp}"`]);
    if (tar.status !== 0) throw new Error(`cannot extract baseline ${baseRef}: ${tar.stderr.trim()}`);
    const demo = path.join(ROOT, DEMO);
    const load = async (dir) => import(pathToFileURL(path.join(dir, 'plugins/zimone/runtime/lib/workbook.mjs')).href);
    const [before, after] = [await load(tmp), await load(ROOT)];
    const diffs = [];
    for (const u of after.loadWorkbook(demo).units) {
      if (!after.unitExists(demo, u.id)) continue;
      const a = before.readUnit(demo, u.id).html;
      const b = after.readUnit(demo, u.id).html;
      if (a !== b) diffs.push(u.id);
    }
    return diffs.length
      ? { ok: false, detail: `rendered HTML changed for: ${diffs.join(', ')} (existing threads may detach; justify or fix)` }
      : { ok: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Which checks apply.
const plugin = touches('plugins/zimone/');
if (touches('plugins/zimone/', '.claude-plugin/', '.claude/skills/')) {
  check('claude plugin validate .', () => command('claude', ['plugin', 'validate', '.']));
}
if (touches('plugins/zimone/runtime/lib/render.mjs', 'plugins/zimone/runtime/lib/workbook.mjs', 'plugins/zimone/runtime/vendor/', 'examples/demo/')) {
  check(`zimone check ${DEMO}`, () => command('node', [CLI, 'check', DEMO]));
}
if (touches('plugins/zimone/runtime/lib/render.mjs', 'plugins/zimone/runtime/lib/workbook.mjs', 'plugins/zimone/runtime/vendor/')) {
  let r;
  try {
    r = await rendererStability();
  } catch (err) {
    r = { ok: false, detail: err.message };
  }
  const name = `renderer stability vs ${baseRef === 'HEAD' ? 'HEAD' : '@{u}'}`;
  (r.ok ? ran : failed).push(r.ok ? name : { name, detail: r.detail });
  console.log(r.ok ? `PASS  ${name}` : `FAIL  ${name}\n${r.detail.replace(/^/gm, '      ')}`);
}
if (touches('plugins/zimone/runtime/shell/zimone.js')) {
  check('node --check zimone.js', () => command('node', ['--check', 'plugins/zimone/runtime/shell/zimone.js']));
}
for (const f of files.filter((f) => /^plugins\/zimone\/runtime\/.*\.mjs$/.test(f) && fs.existsSync(path.join(ROOT, f)))) {
  check(`node --check ${path.relative('plugins/zimone/runtime', f)}`, () => command('node', ['--check', f]));
}

// Manual checks owed.
if (touches('plugins/zimone/runtime/shell/')) manual.add('browser: drive the page on a scratch copy (confirm the port with `zimone url`)');
if (touches('plugins/zimone/runtime/lib/server.mjs', 'plugins/zimone/runtime/shell/')) {
  manual.add('scratch server: API with curl, including the 400 error paths');
}
if (touches(CLI)) manual.add('scratch server: CLI `watch` (under timeout), `reply`, `post`, `ack`, `thread`');
if (touches('plugins/zimone/skills/', 'plugins/zimone/reference/', CLI, 'plugins/zimone/runtime/lib/server.mjs')) {
  manual.add('if a CLI command, route, event or field was renamed: grep the old name across skills, reference, docs/API.md, docs/TESTING.md, README, scripts/screenshots/');
  manual.add('live tutoring test (skills, references and renames are only tested by use; tell the user first)');
}
if (touches('plugins/zimone/runtime/lib/')) {
  manual.add('if the stored format changed: WORKBOOK_FORMAT / STATE_VERSION bumped, with a migration or clear error; test an old-format scratch workbook');
}
if (touches('plugins/zimone/runtime/shell/')) manual.add('if the UI changed visibly: node scripts/screenshots/take.mjs and commit the new images');
if (touches('docs/', 'README.md') && !plugin) manual.add('docs: check that quoted commands, paths and links still exist');

// Reminders.
if (touches('plugins/zimone/runtime/lib/server.mjs', 'plugins/zimone/runtime/shell/', CLI) && !touches('docs/API.md')) {
  notes.push('server/page/CLI changed but docs/API.md did not: confirm the contract is unchanged');
}
if (plugin) notes.push('plugins/zimone/ changed: check the version-bump skill before pushing');

console.log('\nManual checks still owed:');
if (manual.size === 0) console.log('  (none)');
for (const m of manual) console.log(`  - ${m}`);
if (notes.length) {
  console.log('\nNotes:');
  for (const n of notes) console.log(`  - ${n}`);
}
console.log(`\nSummary: ${ran.length} passed, ${failed.length} failed, ${manual.size} manual owed`);
process.exit(failed.length ? 1 : 0);
