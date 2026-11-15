# codie

A book you can talk to. A live Claude Code session interviews you about what you want to learn,
plans a course, and writes it as chapters. You read them in the browser. You can select any passage
and ask about it, answer retrieval checks, and mark chapters finished. All of that comes back to the
same session, which answers you, adds margin notes, keeps a model of what you know, and adapts the
chapters you haven't reached yet.

## Use

From this folder, in Claude Code:

```
/codie new Hegel        # interview → plan you approve → chapter one → opens the book
/codie open books/hegel # serve an existing book in a new session
```

To look at the reader without an agent:

```bash
node bin/codie.mjs serve examples/demo
```

Then open http://127.0.0.1:4317/.

Needs Node 20+ and has no dependencies.

## How it fits together

```
browser ──HTTP/SSE──▶ codie server ──claim──◀ codie watch ──stdout──▶ Monitor ──▶ Claude session
   ▲                       │  ▲                                                       │
   └──── SSE: replies, ────┘  └──────────── codie reply / ack (HTTP) ◀────────────────┤
         reloads                                                                       │
   ▲                                                                                   │
   └─────────── fs.watch on chapters/*.md ◀──── session edits chapter files ◀──────────┘
```

- **`bin/codie.mjs`** provides `serve`, `watch`, `reply`, `ack`, `thread` and `check`.
- **`lib/render.mjs`** renders the chapter Markdown. Every block must carry a `{#id}`. Questions are
  anchored to block ids plus the quoted text with surrounding context, so they survive edits.
- **`lib/server.mjs`** is the HTTP server. It is bound to 127.0.0.1 and rejects foreign Host and
  Origin headers and non-JSON POSTs, so other web pages can't inject events into the session.
- **`shell/`** is the reader page: highlight-to-ask, threads, glosses, checks with confidence
  ratings, and live reload.
- **`.claude/skills/codie/SKILL.md`** holds the agent's instructions: the intake interview,
  planning, the chapter format, and how to handle each event.

A book is a folder:

```
books/<slug>/
  book.json        title + ordered chapter list (written or not)
  plan.md          aim, objectives O1…, syllabus, amendments log
  learner.md       goals, starting point, preferences, objective evidence, inquiry log
  chapters/*.md    chapter source
  .codie/          server state: threads and the event queue (state.json), server.json
```

## Event transport

Reader events reach the session through a Monitor running `codie watch`. Unhandled events are
redelivered whenever the watcher restarts, because a Monitor lasts at most 30 minutes before it
has to be re-armed. Claude Code
[channels](https://code.claude.com/docs/en/channels) are the alternative. They are flag-gated
during the research preview, but they would remove the re-arming and could forward permission
prompts to the page. Only `codie watch` would need to change.
