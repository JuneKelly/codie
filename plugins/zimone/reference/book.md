# zimone book reference

`$ZIMONE` below means the zimone CLI command that the invoking skill gave you
(`node <plugin root>/runtime/bin/zimone.mjs`).

## Book folder

A book is a self-contained folder, and ideally the project a Claude Code session runs in.

```
<book>/
  book.json        title + ordered list of every planned chapter (written or not)
  plan.md          aim, objectives, syllabus, amendments log
  learner.md       motivation, goals, starting point, preferences, objective evidence, inquiry log
  brief.md         (only if the book was commissioned from another session)
  context/         (optional) copied material the book draws on, e.g. a schema or code excerpt
  chapters/<id>.md chapter source
  .gitignore       contains ".zimone/"
  .zimone/         server state (threads, event queue): never edit by hand
```

### book.json

```json
{
  "zimone_format": 1,
  "title": "Reading Hegel",
  "subtitle": "From Kant's problem to the Phenomenology",
  "chapters": [
    { "id": "01-the-problem", "title": "The Problem Hegel Inherited" }
  ]
}
```

`zimone_format` must be `1`. Chapter ids match `[A-Za-z0-9][\w-]*` and name the file
`chapters/<id>.md`. List every chapter in the syllabus, including ones not written yet.

### plan.md

- **Aim**: one paragraph.
- **Learning objectives**: `O1`, `O2`, …, each something checkable ("explain why recognition
  must be mutual in the master–slave dialectic"), not a topic.
- **Syllabus**: one entry per chapter with why it's there, the objectives it serves, and its
  prerequisites.
- **Amendments**: a dated log of changes to the plan and why. Starts empty.

### learner.md

- **Motivation**: why they're learning this now. For a commissioned book, take it from the
  brief (e.g. "fixing slow report queries in their app"), and keep tying chapters back to it.
- **Goals**, **Starting point** (what the diagnostic or observations showed), **Preferences**.
- **Objectives**: a table `| Objective | Status | Evidence |`. Status is `not started`,
  `emerging` or `secure`.
- **Inquiry log**: one line per question, e.g.
  `- 2026-11-15 · 01-the-problem #c1-p04 · asked why X → suggests Y`.

### brief.md (written by a commissioning session)

```
# Brief: <topic>

- Commissioned: <date>, from <absolute path of the originating project>

## Goal
## Motivation
## What the learner already knows
(Observations from the commissioning conversation, with evidence.)
## Preferences
## Context files
- context/<file> — what it is and how the book should use it
## Still to settle
(Questions the commissioning interview didn't resolve, e.g. time budget.)
```

## Chapter format

Blocks are separated by blank lines. **Every top-level block ends with `{#id}`**: on its last
line, or on the opening line of a ``` fence or `:::` directive. Ids must be unique within the
chapter. Use a short prefix and a counter, e.g. `c1-p07`.

```
# The Problem Hegel Inherited {#c1-h1}

Paragraph text with **bold**, *italic*, `code` and [links](https://example.org). {#c1-p01}

> A quotation, with its source given in the text or the next block. {#c1-q01}

- list item
- another item {#c1-l01}

:::check {#c1-chk1 objective=O1}
In your own words: why did Kant think reason gets into trouble when it reasons about the world as a whole?
:::

:::gloss {#c1-g01 for=c1-p01}
A margin note attached to block c1-p01. It renders just below that block.
:::
```

Within a block, write standard CommonMark plus pipe tables (rendered by markdown-it): headings,
paragraphs, blockquotes, nested lists, fenced code, `---`, bold/italic/code/links, and tables
(`| a | b |` with a `|---|---|` row under the header; write a literal pipe in a cell as `\|`,
even inside code). Raw HTML is shown as text, and images appear only as links, so don't use
either. A blank line always starts a new block, so keep each list, table or quote free of blank
lines.

Write and edit chapter files with your Write and Edit tools, not shell scripts. After writing or
editing a chapter, run `$ZIMONE check <book> <chapter-id>` and fix every error. Never leave the
checker failing.

### Keeping ids stable

Reader questions are anchored to block ids and the quoted text. When you edit a block,
**keep its id**. Give new blocks new ids. Never renumber. Deleting a block orphans its
threads, so delete only when you must.

## Writing well for this reader

- Pitch each chapter at the level recorded in `learner.md`. Open by connecting to what came
  before and, where it fits, to the learner's **Motivation**.
- If there is a `context/` folder, use its material for running examples. Quote from it only
  as much as the point needs.
- Put a `:::check` at the end of each major section, with `objective=O#`. How many depends on
  the active-learning preference (light: 1 per chapter, regular: 2–3, heavy: 1 per section).
  Checks should ask for explanation or application, not recall of a phrase.
- **Quote only text you have actually fetched or read in this session.** Give a citation (work,
  section or paragraph, translation or edition). Prefer public-domain sources for long
  quotations, and keep quotations from in-copyright works short.
- Where interpretations or practices differ, name the positions. Don't present one as settled.
- Write each later chapter when the reader finishes the one before it, so it reflects their
  questions and how the checks went.
