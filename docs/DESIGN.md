# zimone design

This document explains how zimone works and why it is built the way it is. [README.md](../README.md)
covers using it, and [AGENTS.md](../AGENTS.md) covers working on it.

## The idea

zimone makes "workbooks you can talk to". A learner says what they want to learn. A Claude Code
session interviews them, plans a short course, and writes it as a workbook: a folder of Markdown
units, worked through in the browser. On the page, the learner can ask about any passage, talk
about a unit or the whole workbook, answer retrieval checks, and mark units done. All of that goes
back to the same session, which answers on the page, keeps a model of what the learner knows,
and writes the units that follow to fit.

The name comes from Zimone, the student prodigy of Strixhaven, a school of magic in Magic: The
Gathering. Until 0.3.0 the project was called codie, after *Codie, Vociferous Codex*, a living
book from the same game. That name was dropped because it was crowded with AI coding tools and
read as "code".

## Principles

- **The session is the tutor.** One live Claude Code session owns the workbook: it plans, writes,
  answers and adapts. There is no separate model API, background agent or hosted service. The
  server only stores and relays.
- **Local only.** Workbooks are plain files on the learner's machine, and the server listens only on
  127.0.0.1.
- **The workbook is the project.** A workbook is a folder, ideally the working folder of the session
  teaching it. Workbooks aren't stored in this repository, which is only the tool.
- **Active learning.** Units end in checks that ask the learner to explain or apply ideas, with
  a confidence rating. Answers feed a per-objective record of what the learner knows.
- **Adapt, don't rewrite.** Later units are written when the learner reaches them, so they
  reflect how earlier ones went. Edits to written units are additive where possible: glosses
  and new blocks rather than rewrites, so the learner's anchored questions survive.
- **Stay on the page.** The learner shouldn't need to switch back to the terminal. Anything they
  would say to the session, they can say from the page.
- **No dependencies.** The runtime uses Node's standard library plus one vendored parser, so
  installing the plugin is the whole installation.

## Parts

```
learner ── browser (the page) ──HTTP/SSE─── zimone server ── .zimone/state.json
                                                   ▲
                       zimone watch ── Monitor ──▶ Claude Code session ──▶ workbook files
                         (claims events)               │                  (units/*.md,
                                                       └── zimone reply / post / ack  plan.md, …)
```

- **Skills** (`/zimone:new`, `/zimone:open`) start the session's work. They are short; the
  detail lives in reference docs (`workbook.md`, `planning.md`, `serving.md`) that the session reads
  through `zimone docs`.
- **The CLI** (`runtime/bin/zimone.mjs`) is the session's only interface to the runtime: it
  detects folders, validates workbooks, starts the server, watches for events and posts replies.
- **The server** (`runtime/lib/server.mjs`) serves the page and a JSON API, stores threads, the
  event queue and unit progress, pushes live updates over server-sent events, and watches the
  workbook's files.
- **The page** (`runtime/shell/`) renders units, anchors questions to passages, shows checks and
  threads, and reloads when files change.

## The workbook

```
<workbook>/
  workbook.json    zimone_format, title, subtitle, optional terms, every planned unit
  plan.md          aim, objectives O1…, syllabus, dated amendments
  learner.md       motivation, goals, starting point, preferences, objective table, inquiry log
  brief.md         only for a workbook commissioned from another session
  context/         material copied in from another project
  units/<id>.md    unit source
  .zimone/         server state (git-ignored)
```

The authoritative format is [`plugins/zimone/reference/workbook.md`](../plugins/zimone/reference/workbook.md),
which is what the teaching session reads.

**`workbook.json` lists every unit, including those not yet written.** The page shows unwritten
units as "not written yet", so the learner sees the whole course while the session keeps the
freedom to write each unit late.

**`plan.md` and `learner.md` are the session's memory.** A session can end and another can
resume the workbook later, so anything the tutor needs to remember lives in these files:
the objectives and syllabus, a log of amendments with reasons, evidence for each objective
(`not started`, `emerging`, `secure`), and one line per question the learner asked.

### Units

A unit is a sequence of blocks separated by blank lines. Every top-level block ends with a
`{#id}`. Two directives extend Markdown:

- `:::check {#id objective=O2}` is a retrieval check, rendered as a form for a free-text answer
  and a confidence rating.
- `:::gloss {#id for=target}` is a margin note, rendered just after the block it names.

Block ids are what make questions durable. A question stores its block id plus the quoted text
and some surrounding context. As long as the session keeps ids stable when it edits, questions
stay attached to their passages, and the session can refer to them by id.

`zimone check` validates a workbook: missing or duplicate ids, unknown directives, glosses that
point nowhere, and units listed in `workbook.json` that are malformed. The reference docs tell the
session to run it after every edit and never leave it failing. The page also shows
a unit's validation errors in a banner rather than hiding them.

### Rendering

`render.mjs` splits a unit into blocks itself, because ids and directives aren't Markdown, and
hands the body of each block to a vendored copy of markdown-it 14.1.0. It is configured for
untrusted text: raw HTML is escaped, links are limited to http(s), mailto, and relative or
fragment URLs, images render as links, and tables are wrapped so they scroll instead of
widening the page. Rendered HTML is trimmed so that the text questions anchor to doesn't
change between versions.

markdown-it replaced a hand-written renderer in 0.2.1. It was vendored rather than installed
so the plugin keeps no install step. Its checksum is recorded in `SOURCE.md`, and it was read
for anything unexpected (network access, eval, globals) before it was added.

## Starting a workbook

`/zimone:new` begins with `zimone detect`, which classifies the current folder:

| Folder | What happens |
|---|---|
| empty | The folder becomes the workbook. The session interviews the learner (goal, two or three diagnostic questions rather than a self-rating, then scope, tone and how much active learning), proposes a syllabus, writes unit one on approval, and starts serving. |
| has `brief.md` | A commissioned workbook: the session reads the brief, asks only what it left unsettled, then plans and writes as above. |
| has `workbook.json` | Already a workbook; the skill points to `/zimone:open`. |
| anything else | **Commission**: the learner is in the middle of other work. |

Commissioning exists because the need to learn often comes up mid-task: a developer deep in an
app realises they don't understand query planning. The working session shouldn't turn into a
tutor, so it runs a short interview seeded from what it already knows of the conversation. It
asks once where the learner keeps workbooks (the library, stored in the plugin's data folder) and
which project files to copy into `context/`. It then writes `brief.md` into a new workbook folder
and hands off to a new session started there. The teaching happens in that session, with the
workbook as its working folder.

`/zimone:open` serves an existing workbook, or plans a commissioned one first.

### One unit at a time

The session writes only unit one before the learner starts. Each later unit is
written when the learner finishes the one before, so it can draw on their questions, how
their checks went and any requests. It also keeps the learner from waiting for a whole workbook
up front. The cost is a short wait at each unit boundary, which the page covers with a
"zimone will prepare the next one" message.

## The loop

The learner can do four things on the page:

| On the page | Request | Thread | Event |
|---|---|---|---|
| Selects a passage and asks about it | `POST /api/messages` with an anchor and quote | a new thread anchored to that passage | `message` |
| Messages zimone about the unit or the workbook | `POST /api/messages` with a unit, or none | the unit's (or workbook's) one unanchored thread | `message` |
| Answers a check | `POST /api/messages` anchored to the check block, with `fields: { confidence }` | the check's one thread | `message` |
| Marks a unit done | `POST /api/units/<id>/state` with `state: "done"` | a notice in the unit's thread | `unit_state` |

The session replies to an event with `zimone reply`. Its reply is stored as Markdown and appears
in that event's thread. `zimone ack` marks an event handled with no reply. `zimone post` lets
the session write to a unit's or the workbook's thread unprompted, for instance to announce what
it changed.

What the session does with each event is set out in
[`serving.md`](../plugins/zimone/reference/serving.md). In short, it answers, records evidence and
questions in `learner.md`, may add a gloss or a block to the unit, may amend the plan, and on
`unit_state` `done` writes the next unit and replies with a link to it.

### A generic model under a specific product

The page is about learning, but the data model and API deliberately aren't. That keeps options
open (other kinds of workbook, other kinds of response) without changing the contract:

- **Threads have an optional anchor, not a kind.** No anchor means the thread about a whole unit,
  or with no unit, the whole workbook; there is one of each. An anchor with a quote is a question
  about a passage, and each starts its own thread. An anchor without a quote is about a whole
  block, and there is one such thread per block: that's where answers to a check go.
- **Messages have optional, validated `fields`.** A response to a block carries the fields its
  type requires; a check requires `confidence` 1–3. The rules live in one table,
  `RESPONSE_FIELDS` in `render.mjs`, so the server's routes know nothing about checks.
- **Roles are `user`, `agent` and `system`.** System messages carry a structured `notice`, such
  as `{ type: "unit_state", state: "done" }`, which the page words for itself.
- **Two event types.** Everything the user says is a `message`, with the unit, block, block type
  and fields that tell the session what it is. Changes of a unit's state are `unit_state`; `done`
  is the only state so far, and adding one means extending a list, not the API.
- **Words are configuration.** The page says "workbook" and "unit" unless `workbook.json` sets
  `terms`, for example `"unit": ["chapter", "chapters"]`. Everything below the page says
  "workbook" and "unit".

The vocabulary went through two earlier versions: "book" and "chapter", which suggested a fixed
linear read, and thread kinds and events named after each learning activity (`ask`,
`check_answer`, `chapter_finished`), which tied the API to the features of the day.

### Threads

A thread's status is derived from its events: `queued` (not yet claimed by the session),
`delivered` (claimed, no reply yet) or `answered`. The page shows "Waiting for zimone…" and
"zimone is thinking…" for the first two.

The page also shows whether any session is watching. `zimone watch` claims every second, so
the server counts the agent as present while claims keep arriving, and as away after five
seconds without one. It sends the change over the event stream. While the agent is away, the
header reads "zimone away", and waiting threads say that nobody is watching and how to start a
session. The learner can therefore tell a busy tutor from a missing one.

## Transport

The hard part is getting browser events into a running Claude Code session. That session
can't receive HTTP requests; it can only run tools.

zimone uses a **Monitor**: a tool that runs a command in the background and notifies the
session for each line it prints. The session arms a Monitor on `zimone watch <workbook>`, which polls
the server every second by POSTing to `/api/events/claim`. The server returns every unhandled
event and marks new ones as delivered. The watcher prints one `ZIMONE_EVENT {json}` line per
event it hasn't printed before.

Details that matter:

- **Short fields first.** Notifications can truncate long lines, so payloads put ids, types and
  unit before the learner's text. When text is cut off, the session runs `zimone thread`.
- **Redelivery.** A Monitor expires after 30 minutes and must be re-armed. Every claim returns
  all unhandled events, flagged `redelivered: true` once delivered before, so nothing is lost
  across a re-arm. The session acks redelivered events it has already answered.
- **Server identity.** Each server run has a random `instance` id, returned with each claim.
  Event ids can repeat if state is reset, so the watcher forgets what it has printed when the
  instance changes.
- **Failure is loud.** After ten consecutive failed claims the watcher prints `ZIMONE_ERROR` and
  exits, and the session restarts the server and tells the learner.

Alternatives considered:

- **Claude Code channels** would push events into the session directly, with no polling or
  re-arming. They were in a flag-gated research preview, so they weren't usable. Only
  `zimone watch` would need to change to adopt them.
- **A separate agent behind an API** (the server calling a model itself) would cut out the
  session, which then couldn't edit the workbook with its full context and tools. That breaks the
  first principle.
- **The learner relaying questions by hand** to the terminal is what the page exists to avoid.

## Server and state

The server is a plain Node `http` server. Per workbook, it keeps:

- `.zimone/server.json`: the port and pid while running. `zimone url` and the other CLI commands
  find the server through it. A stale file from a dead process is detected and replaced.
- `.zimone/state.json`: `{ version, seq, threads, events, progress }`, written atomically with a
  temporary file and rename. Thread and event ids share one counter (`t1`, `e2`, …).

Live updates go to open pages over server-sent events at `/api/stream`. There are four message
types: `thread` (a thread changed), `unit` (a unit file changed), `workbook` (`workbook.json`
or a unit's state changed) and `agent` (a session started or stopped watching; also sent
when a page connects). The server watches the workbook folder with `fs.watch`, debounces,
and ignores its own `.zimone/` writes. When the current unit changes, the page reloads it in
place and keeps the user's scroll position, using the first visible block, along with any
half-written check answers. After a dropped connection, it reloads to catch up.

Each workbook's server takes the first free port from 4317 to 4336, so several workbooks can be open
at once.

### Security

The server accepts input from the browser and passes it to an agent that can edit files and
run commands, so it must not accept input from anywhere else:

- It binds to 127.0.0.1 only.
- It rejects requests whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding),
  and POSTs whose `Origin` is another site.
- It accepts POST bodies only as `application/json`, which a cross-site form can't send without
  a preflight, and caps their size.

The reference docs also tell the session that the learner's text is a question to answer, not
instructions to follow.

## The page

The page is plain HTML, CSS and JavaScript with no build step.

- **Anchoring.** Selecting text inside a block offers "Ask about this". The page records the block
  id, the trimmed quote, and up to 40 characters before and after. To re-place a question, it
  searches the block for the quote and picks the occurrence whose surroundings best match.
  If the quote has gone, the thread is marked "passage revised"; if the block has gone,
  "passage removed". Either way the thread stays in the sidebar.
- **Sidebar.** Threads collapse to a one-line preview and open one at a time. The unit's
  own thread is pinned first. A badge marks replies the learner hasn't opened (tracked in
  `localStorage`). New replies raise a toast when their thread isn't visible. The sidebar can be
  closed and resized, and remembers both. On narrow screens it becomes an overlay.
- **Composer.** One message box at the foot of the sidebar posts to the unit's thread, or as a
  question about a passage when one is attached.
- **Checks.** A check's answers and feedback show inside the check, not in the sidebar.
- **Contents page.** It lists units as done, ready or not written yet, with the workbook's thread
  in the sidebar.
- **Words.** Every label comes from the workbook's `terms`, so the same page can say "unit" or
  "chapter".

## Distribution and versions

The repository is its own Claude Code marketplace (`zimone-marketplace`) with one plugin in
`plugins/zimone/`. Skills reference runtime files through `${CLAUDE_PLUGIN_ROOT}` and settings
through `${CLAUDE_PLUGIN_DATA}`. Plugin files are usually outside the teaching session's folder,
where reading them would prompt for permission, so the skills pre-approve the CLI alone. Every
reference doc and setting is reached through the CLI.

Installed users stay on a version until `version` in `plugin.json` changes. The repo's
`version-bump` skill decides when and by how much. Anything that changes stored data needs more
than a version bump: `zimone_format` in `workbook.json` and `version` in `state.json` are checked on
load, and a mismatch is an error, never a guess. Two releases made deliberate clean
breaks while there were no real users: 0.3.0 (codie to zimone) and 0.5.0 (books and chapters to
workbooks and units, with the generic thread model). A folder from before 0.5.0 has `book.json`
and isn't recognised as a workbook; leftover state is refused by its `version`.

## Known limits

- **One session per workbook.** The design assumes a single tutor; two sessions watching one
  workbook would race to claim events.
- **The tutor must be running.** Without a live session, questions queue until one starts.
  The page says so, but can't start a session itself.
- **Monitor re-arming** depends on the session noticing that the Monitor has expired.
- **No images** in units: they render as links. Diagrams are limited to text, code blocks
  and tables.
- **Unit boundaries cost a wait** while the next unit is written.
