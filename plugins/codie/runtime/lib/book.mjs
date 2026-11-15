import fs from 'node:fs';
import path from 'node:path';
import { renderChapter } from './render.mjs';

const ID_RE = /^[A-Za-z0-9][\w-]*$/;
export const BOOK_FORMAT = 1;

export class BookError extends Error {}

export function resolveBookDir(arg) {
  if (!arg) throw new BookError('missing <book> argument (a directory containing book.json)');
  const dir = path.resolve(arg);
  if (!fs.existsSync(path.join(dir, 'book.json'))) throw new BookError(`${dir} has no book.json`);
  return dir;
}

// Reads and validates book.json. Throws BookError on any missing or invalid field.
export function loadBook(dir) {
  const file = path.join(dir, 'book.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new BookError(`cannot read ${file}: ${err.message}`, { cause: err });
  }
  if (data.codie_format === undefined) throw new BookError(`${file}: missing "codie_format" (expected ${BOOK_FORMAT}); is this a codie book?`);
  if (data.codie_format !== BOOK_FORMAT) throw new BookError(`${file}: codie_format ${JSON.stringify(data.codie_format)} is not supported (this codie reads format ${BOOK_FORMAT})`);
  if (typeof data.title !== 'string' || !data.title.trim()) throw new BookError(`${file}: "title" must be a non-empty string`);
  if (!Array.isArray(data.chapters) || data.chapters.length === 0) throw new BookError(`${file}: "chapters" must be a non-empty array`);
  const ids = new Set();
  data.chapters.forEach((c, i) => {
    if (!c || typeof c.id !== 'string' || !ID_RE.test(c.id)) throw new BookError(`${file}: chapters[${i}].id must match ${ID_RE}`);
    if (typeof c.title !== 'string' || !c.title.trim()) throw new BookError(`${file}: chapters[${i}].title must be a non-empty string`);
    if (ids.has(c.id)) throw new BookError(`${file}: duplicate chapter id "${c.id}"`);
    ids.add(c.id);
  });
  return { title: data.title, subtitle: typeof data.subtitle === 'string' ? data.subtitle : null, chapters: data.chapters.map((c) => ({ id: c.id, title: c.title })) };
}

export function chapterFile(dir, id) {
  return path.join(dir, 'chapters', `${id}.md`);
}

export function chapterExists(dir, id) {
  return fs.existsSync(chapterFile(dir, id));
}

// Returns {id, title, html, blocks, errors, prev, next} or throws BookError.
export function readChapter(dir, id) {
  const book = loadBook(dir);
  const idx = book.chapters.findIndex((c) => c.id === id);
  if (idx === -1) throw new BookError(`chapter "${id}" is not listed in book.json`);
  const file = chapterFile(dir, id);
  if (!fs.existsSync(file)) throw new BookError(`chapter "${id}" has not been written yet (${path.relative(dir, file)} is missing)`);
  const rendered = renderChapter(fs.readFileSync(file, 'utf8'));
  const neighbour = (c) => (c ? { id: c.id, title: c.title, exists: chapterExists(dir, c.id) } : null);
  return {
    id,
    title: book.chapters[idx].title,
    ...rendered,
    prev: neighbour(book.chapters[idx - 1]),
    next: neighbour(book.chapters[idx + 1]),
  };
}

// Classifies a folder for /codie:new: 'book' (has book.json), 'brief' (has brief.md),
// 'empty' (nothing but dotfiles), 'other', or 'missing'.
export function detectFolder(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return 'missing';
  if (!fs.statSync(abs).isDirectory()) throw new BookError(`${abs} is not a directory`);
  if (fs.existsSync(path.join(abs, 'book.json'))) return 'book';
  if (fs.existsSync(path.join(abs, 'brief.md'))) return 'brief';
  return fs.readdirSync(abs).some((n) => !n.startsWith('.')) ? 'other' : 'empty';
}
