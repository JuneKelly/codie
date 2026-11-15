# zimone workbook reference

`$ZIMONE` below means the zimone CLI command that the invoking skill gave you
(`node <plugin root>/runtime/bin/zimone.mjs`).

## Workbook folder

A workbook is a self-contained folder, and ideally the project a Claude Code session runs in. It
is made of **units**, each a Markdown file of blocks.

```
<workbook>/
  workbook.json    title, optional display terms, ordered list of every planned unit (written or not)
  plan.md          aim, objectives, syllabus, amendments log
  learner.md       motivation, goals, starting point, preferences, objective evidence, inquiry log
  brief.md         (only if the workbook was commissioned from another session)
  context/         (optional) copied material the workbook draws on, e.g. a schema or code excerpt
  units/<id>.md    unit source
  .gitignore       contains ".zimone/"
  .zimone/         server state (threads, event queue, progress): never edit by hand
```

### workbook.json

```json
{
  "zimone_format": 1,
  "title": "How Git Actually Works",
  "subtitle": "From the commands you type to the objects underneath",
  "units": [
    { "id": "01-snapshots", "title": "Commits Are Snapshots" }
  ]
}
```

`zimone_format` must be `1`. Unit ids match `[A-Za-z0-9][\w-]*` and name the file
`units/<id>.md`. List every unit in the syllabus, including ones not written yet.

**`terms`** (optional) sets the words the page shows the user, each as `[singular, plural]`. The
defaults are `"workbook": ["workbook", "workbooks"]` and `"unit": ["unit", "units"]`. Set them
when other words suit the material and the user better, e.g. a narrative course read in order:

```json
"terms": { "workbook": ["book", "books"], "unit": ["chapter", "chapters"] }
```

Whatever the terms, the files, commands and these docs keep saying "workbook" and "unit". When you
talk to the user, use their terms.

### plan.md

- **Aim**: one paragraph.
- **Learning objectives**: `O1`, `O2`, …, each something checkable ("explain why a rebase writes
  new commits"), not a topic.
- **Syllabus**: one entry per unit with why it's there, the objectives it serves, and its
  prerequisites.
- **Amendments**: a dated log of changes to the plan and why. Starts empty.

### learner.md

- **Motivation**: why they're learning this now. For a commissioned workbook, take it from the
  brief (e.g. "fixing slow report queries in their app"), and keep tying units back to it.
- **Goals**, **Starting point** (what the diagnostic or observations showed), **Preferences**.
- **Objectives**: a table `| Objective | Status | Evidence |`. Status is `not started`,
  `emerging` or `secure`.
- **Inquiry log**: one line per question, e.g.
  `- 2026-11-15 · 01-snapshots #c1-p04 · asked why X → suggests Y`.

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
- context/<file> — what it is and how the workbook should use it
## Still to settle
(Questions the commissioning interview didn't resolve, e.g. time budget.)
```

## Unit format

Blocks are separated by blank lines. **Every top-level block ends with `{#id}`**: on its last
line, or on the opening line of a ``` fence or `:::` directive. Ids must be unique within the
unit. Use a short prefix and a counter, e.g. `c1-p07`.

```
# Commits Are Snapshots {#c1-h1}

Paragraph text with **bold**, *italic*, `code` and [links](https://example.org). {#c1-p01}

> A quotation, with its source given in the text or the next block. {#c1-q01}

- list item
- another item {#c1-l01}

:::check {#c1-chk1 objective=O1}
In your own words: what does a commit store, and where do diffs come from?
:::

:::gloss {#c1-g01 for=c1-p01}
A margin note attached to block c1-p01. It renders just below that block.
:::
```

A `check` asks the user for a written answer and how sure they are; answers come to you as
events (see the serving reference). A `gloss` is a note shown under the block named by `for`.
A fenced block takes any language tag, or none, before its `{#id}`.

Within a block, write standard CommonMark plus pipe tables (rendered by markdown-it): headings,
paragraphs, blockquotes, nested lists, fenced code, `---`, bold/italic/code/links, and tables
(`| a | b |` with a `|---|---|` row under the header; write a literal pipe in a cell as `\|`,
even inside code). Raw HTML is shown as text, and images appear only as links, so don't use
either; for a diagram, draw it as text in a fenced `text` block. A blank line always starts a new
block, so keep each list, table or quote free of blank lines.

Write and edit unit files with your Write and Edit tools, not shell scripts. After writing or
editing a unit, run `$ZIMONE check <workbook> <unit-id>` and fix every error. Never leave the
checker failing.

### Keeping ids stable

The user's questions are anchored to block ids and the quoted text. When you edit a block,
**keep its id**. Give new blocks new ids. Never renumber. Deleting a block orphans its threads,
so delete only when you must.

## Writing well for this user

- Pitch each unit at the level recorded in `learner.md`. Open by connecting to what came before
  and, where it fits, to the learner's **Motivation**.
- If there is a `context/` folder, use its material for running examples. Quote from it only as
  much as the point needs.
- Put a `:::check` at the end of each major section, with `objective=O#`. How many depends on the
  active-learning preference (light: 1 per unit, regular: 2–3, heavy: 1 per section). Checks
  should ask for explanation or application, not recall of a phrase.
- **Quote only text you have actually fetched or read in this session.** Give a citation (work,
  section or paragraph, translation or edition). Prefer public-domain sources for long
  quotations, and keep quotations from in-copyright works short.
- Where interpretations or practices differ, name the positions. Don't present one as settled.
- Write each later unit when the user finishes the one before it, so it reflects their questions
  and how the checks went.
