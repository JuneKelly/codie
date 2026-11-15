import fs from 'node:fs';
import path from 'node:path';
import { renderUnit } from './render.mjs';

const ID_RE = /^[A-Za-z0-9][\w-]*$/;
export const WORKBOOK_FORMAT = 1;

// What the page calls things, unless workbook.json's "terms" says otherwise: [singular, plural].
export const DEFAULT_TERMS = { workbook: ['workbook', 'workbooks'], unit: ['unit', 'units'] };

export class WorkbookError extends Error {}

export function resolveWorkbookDir(arg) {
  if (!arg) throw new WorkbookError('missing <workbook> argument (a directory containing workbook.json)');
  const dir = path.resolve(arg);
  if (!fs.existsSync(path.join(dir, 'workbook.json'))) throw new WorkbookError(`${dir} has no workbook.json`);
  return dir;
}

// "terms" is optional; each entry it gives must be a [singular, plural] pair of non-empty strings.
function parseTerms(file, raw) {
  if (raw === undefined) return { ...DEFAULT_TERMS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkbookError(`${file}: "terms" must be an object`);
  const terms = { ...DEFAULT_TERMS };
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in DEFAULT_TERMS)) throw new WorkbookError(`${file}: unknown term "${key}" (known: ${Object.keys(DEFAULT_TERMS).join(', ')})`);
    if (!Array.isArray(value) || value.length !== 2 || !value.every((s) => typeof s === 'string' && s.trim())) {
      throw new WorkbookError(`${file}: terms.${key} must be ["singular", "plural"]`);
    }
    terms[key] = value;
  }
  return terms;
}

// Reads and validates workbook.json. Throws WorkbookError on any missing or invalid field.
export function loadWorkbook(dir) {
  const file = path.join(dir, 'workbook.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new WorkbookError(`cannot read ${file}: ${err.message}`, { cause: err });
  }
  if (data.zimone_format === undefined) throw new WorkbookError(`${file}: missing "zimone_format" (expected ${WORKBOOK_FORMAT})`);
  if (data.zimone_format !== WORKBOOK_FORMAT) throw new WorkbookError(`${file}: zimone_format ${JSON.stringify(data.zimone_format)} is not supported (this zimone reads format ${WORKBOOK_FORMAT})`);
  if (typeof data.title !== 'string' || !data.title.trim()) throw new WorkbookError(`${file}: "title" must be a non-empty string`);
  if (data.subtitle !== undefined && typeof data.subtitle !== 'string') throw new WorkbookError(`${file}: "subtitle" must be a string`);
  if (!Array.isArray(data.units) || data.units.length === 0) throw new WorkbookError(`${file}: "units" must be a non-empty array`);
  const ids = new Set();
  data.units.forEach((u, i) => {
    if (!u || typeof u.id !== 'string' || !ID_RE.test(u.id)) throw new WorkbookError(`${file}: units[${i}].id must match ${ID_RE}`);
    if (typeof u.title !== 'string' || !u.title.trim()) throw new WorkbookError(`${file}: units[${i}].title must be a non-empty string`);
    if (ids.has(u.id)) throw new WorkbookError(`${file}: duplicate unit id "${u.id}"`);
    ids.add(u.id);
  });
  return {
    title: data.title,
    subtitle: data.subtitle ?? null,
    terms: parseTerms(file, data.terms),
    units: data.units.map((u) => ({ id: u.id, title: u.title })),
  };
}

export function unitFile(dir, id) {
  return path.join(dir, 'units', `${id}.md`);
}

export function unitExists(dir, id) {
  return fs.existsSync(unitFile(dir, id));
}

// Returns {id, title, html, blocks, errors, prev, next} or throws WorkbookError.
export function readUnit(dir, id) {
  const wb = loadWorkbook(dir);
  const idx = wb.units.findIndex((u) => u.id === id);
  if (idx === -1) throw new WorkbookError(`unit "${id}" is not listed in workbook.json`);
  const file = unitFile(dir, id);
  if (!fs.existsSync(file)) throw new WorkbookError(`unit "${id}" has not been written yet (${path.relative(dir, file)} is missing)`);
  const rendered = renderUnit(fs.readFileSync(file, 'utf8'));
  const neighbour = (u) => (u ? { id: u.id, title: u.title, exists: unitExists(dir, u.id) } : null);
  return {
    id,
    title: wb.units[idx].title,
    ...rendered,
    prev: neighbour(wb.units[idx - 1]),
    next: neighbour(wb.units[idx + 1]),
  };
}

// Classifies a folder for /zimone:new: 'workbook' (has workbook.json), 'brief' (has brief.md),
// 'empty' (nothing but dotfiles), 'other', or 'missing'.
export function detectFolder(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return 'missing';
  if (!fs.statSync(abs).isDirectory()) throw new WorkbookError(`${abs} is not a directory`);
  if (fs.existsSync(path.join(abs, 'workbook.json'))) return 'workbook';
  if (fs.existsSync(path.join(abs, 'brief.md'))) return 'brief';
  return fs.readdirSync(abs).some((n) => !n.startsWith('.')) ? 'other' : 'empty';
}
