# codie

Books you can talk to. Claude interviews you about what you want to learn, plans a course,
and writes it as a book: a folder of chapters you read in the browser. You can select any
passage and ask about it, answer retrieval checks, and mark chapters finished. All of that
comes back to the Claude Code session that's teaching you, which answers, adds margin notes,
keeps a model of what you know, and adapts the chapters you haven't reached yet.

This repository is the tool: a Claude Code plugin. Your books live wherever you choose.

## Install

In Claude Code (2.1.275 or later):

```
/plugin install codie --marketplace JuneKelly/codie
```

Or from a shell:

```bash
claude plugin marketplace add JuneKelly/codie
```

```bash
claude plugin install codie@codie-marketplace
```

Requires Node 20 or later. There are no dependencies.

## Use

**Start a book where you are.** In an empty folder, a book folder, or any project:

```
/codie:new relational databases
```

What happens depends on the folder:

- **Empty folder**: codie interviews you (goal, a few diagnostic questions, scope and style),
  proposes a syllabus for your approval, writes chapter one, and opens the book in your browser.
  The folder *is* the book, and this session is its tutor.
- **Another project**: say you're deep in an app and realise you need to understand query
  planning. codie runs a short interview seeded from the conversation. It asks where your book
  library lives (once) and which bits of the project to copy in as context. Then it writes a
  `brief.md` into a new book folder and hands off to a session started there. Your working
  session stays on your work.

**Open a book**, whether it's one you commissioned or one you're coming back to. Start a
session in its folder and run:

```
/codie:open
```

For a commissioned book, the first `/codie:open` settles what the brief left open, proposes
the syllabus, and writes chapter one. After that, it picks up where you left off.

## What a book looks like

```
my-book/
  book.json        codie_format, title, ordered chapter list
  plan.md          aim, objectives O1…, syllabus, amendments log
  learner.md       motivation, goals, starting point, objective evidence, inquiry log
  brief.md         if commissioned from another session
  context/         copied material the book draws on
  chapters/*.md    chapters (Markdown, every block carries a stable {#id})
  .codie/          server state: threads and event queue (git-ignored)
```

A book is plain files, so put it under git if you'd like a history of how it was revised.
`examples/demo` is a small sample.

## How it works

```
browser ──HTTP/SSE──▶ codie server ◀──claim── codie watch ──stdout──▶ Monitor ──▶ Claude session
   ▲                       │  ▲                                                        │
   └── SSE: replies, ──────┘  └──────────── codie reply / ack (HTTP) ◀─────────────────┤
       reloads                                                                          │
   ▲                                                                                    │
   └─────────── fs.watch on chapters/*.md ◀──── session edits chapter files ◀───────────┘
```

| Path | What it is |
|---|---|
| `plugins/codie/skills/new`, `skills/open` | The two skills |
| `plugins/codie/reference/` | Shared agent instructions: book format and authoring, serving and event handling |
| `plugins/codie/runtime/bin/codie.mjs` | CLI: `docs`, `library`, `detect`, `serve`, `url`, `watch`, `reply`, `ack`, `thread`, `check`. The skills pre-approve it, and route reference docs and plugin settings through it, so they don't trigger file-permission prompts |
| `plugins/codie/runtime/lib/` | Chapter renderer and validator, book loader, HTTP server |
| `plugins/codie/runtime/shell/` | The reader page |
| `.claude-plugin/marketplace.json` | Makes this repo its own one-plugin marketplace |

The server binds to 127.0.0.1. It takes the first free port from 4317, so several books can
be open at once. It rejects foreign Host and Origin headers and non-JSON POSTs, so other
websites can't inject events into your session.

Reader events reach the session through a Monitor running `codie watch`. A Monitor has to be
re-armed every 30 minutes; events still unhandled at that point are delivered again.
Claude Code [channels](https://code.claude.com/docs/en/channels) would remove the re-arming,
but they are flag-gated during their research preview. Only `codie watch` would need to change.

## Develop

Load the plugin from this checkout for one session:

```bash
claude --plugin-dir ./plugins/codie
```

Or register the checkout as a local marketplace, so every session picks up your edits (run
`/reload-plugins` to apply them mid-session):

```bash
claude plugin marketplace add ./
```

```bash
claude plugin install codie@codie-marketplace
```

Validate after changes:

```bash
claude plugin validate .
```

Try the reader without an agent:

```bash
node plugins/codie/runtime/bin/codie.mjs serve examples/demo
```
