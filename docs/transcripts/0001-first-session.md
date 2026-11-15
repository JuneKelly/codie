# 0001: First session, from idea to zimone 0.5.0

- **Date:** 2026-11-15, one long Claude Code session in the desktop app (Claude Opus 5.5), with one
  context compaction partway through.
- **Outcome:** the idea was designed, built as a Claude Code plugin, used for a real book,
  renamed from codie to zimone, documented, tested end to end with live tutoring sessions, and
  reworked from books and chapters into workbooks and units on a generic data model. Release
  0.5.0 was pushed at `77aa636`.
- **Words:** sections 1–8 use the words of their time ("book", "chapter", "reader"); section 9
  explains the change.

This is a summary, not a verbatim log. It records the decisions and the reasons for them, and
the mistakes worth not repeating. For how the system works now, read [DESIGN.md](../DESIGN.md).

## 1. The idea

The user proposed a "book you can talk to": an agent plans a curriculum (the example was Hegel)
and writes it as HTML chapters, and the reader highlights text in the browser and asks the agent
about it. The agent answers, and may adjust the text or note the line of enquiry.

The first design response set out the shape that survived:

- a small local server, because a `file://` page can't reach an agent
- the book on disk as the agent's memory (`plan.md`, `learner.md`, chapters with stable block
  ids), because a long session will compact and forget
- the agent writes Markdown and a fixed shell renders it, so the agent can't break the UI
- questions anchored by block id plus a quote with surrounding context (like W3C Web
  Annotations), so they survive edits
- caution about rewriting text the reader is in the middle of: prefer glosses and additions

The user then settled four questions: local only for now; **a live Claude Code session as the
hub**, which starts the server and receives the browser's events; yes to the overall shape; and
yes to active learning. Mid-turn they named the tool `codie`, after *Codie, Vociferous Codex*, a
living book in Magic: The Gathering.

## 2. Transport, intake and the first build

Getting browser events into a running session was the crux. Two options were weighed:

- **Channels**: the built-in mechanism for pushing events into a session, but a flag-gated
  research preview needing `claude --dangerously-load-development-channels`.
- **Monitor**: a background command whose output lines wake the session. It works in the desktop
  app today, but expires every 30 minutes and has to be re-armed.

The user chose **Monitor**. The transport was kept behind `codie watch` so it can be swapped for
channels later.

The user also asked that `/codie new` interview the learner rather than take only a topic
string. The intake became: the goal (what they want to be able to *do*), two or three diagnostic
probe questions instead of a self-rating, then scope, tone, sources and how much active
learning. It produces a filled-in `learner.md`, checkable objectives in `plan.md`, and a syllabus
the learner approves before any chapter is written.

Active learning landed as `:::check` blocks (free-text answer plus a confidence rating) tied to
objectives, and `:::gloss` margin notes. A Hegel demo book and the server, page and CLI were
built and shown working. The user initialised git mid-build and asked for commits as work went.

## 3. Separating the tool from the books

The user wanted the repository to be only the tool, installable by anyone, with books written
wherever the user chooses. Two modes came out of the discussion:

- **The book is the project** (the ideal): a session runs in the book's folder and tutors it.
- **Commission**: from an unrelated session (say, an app whose author realises they need to
  understand databases), run a short interview seeded from the conversation, write a `brief.md`
  into a new book folder in the user's library, and hand off to a new session there.

The repo became a Claude Code plugin with its own marketplace. Skills couldn't read plugin files
from outside their folder without permission prompts, so reference docs and the library setting
moved behind the pre-approved CLI (`codie docs`, `codie library`). The user installed the plugin
and commissioned a real book on relational databases into their library. They noted that opening
an existing book should be `/codie:open`, not a mode of `/codie:new`, and it was changed. Branches
were dropped: commit straight to `main`, push only when asked.

## 4. Reader feedback rounds

The user read the real book and fed back, one change at a time:

- the sidebar needed an easy way to close it
- threads should start collapsed and open one at a time
- having to flick back to the terminal to continue was a drag, so the page gained a message box
  with one ongoing conversation per chapter and one for the book, and `codie say` for the
  session to post unprompted
- the sidebar should be resizable, and a table in a reply made the whole message scroll sideways

They confirmed that writing one chapter at a time is deliberate, so each chapter can reflect
how the last one went.

Asked whether plugin updates reach existing installs, the answer was: only when `version` is
bumped. That led to a project-only `version-bump` skill for future sessions.

## 5. A real Markdown parser

Asked how chapters became HTML, the answer was a hand-written renderer. The user chose to vendor
a real parser. markdown-it 14.1.0 was downloaded with permission, checked against the npm
registry's integrity hash, and scanned at the user's request for anything unexpected (network
access, eval, dynamic code, globals); nothing was found. It is configured for untrusted text and
produces byte-identical HTML for the existing demo chapter.

## 6. Example book and screenshots

The Hegel demo was judged too far from most readers, so it was replaced with "How Git Actually
Works" (two chapters written, two planned). Reader activity was seeded through the real API and
three README screenshots were taken with headless Chrome driven over the DevTools protocol.

## 7. Renaming to zimone

The user worried that "codie" was crowded and read as "code". Names were brainstormed (Nell from
*The Diamond Age*, Bastian, Lucien, Liesel, Paige, and others) and checked against npm, GitHub,
domains and the web:

- **Codie** was crowded with AI coding tools.
- **Nell** was fairly clear, apart from one AI education startup and the NELL research system.
- **Paige** clashed with Paige.AI, a well-known AI pathology company.
- **Zimone** was nearly unclaimed. She is the prodigy student of Strixhaven, a school of magic in
  the same game, and one of her cards is *Zimone, All-Questioning*.

The user chose zimone and a **clean break** for stored data (`zimone_format`, `.zimone/`), with a
clear error for old books rather than a migration. Their one real book was converted by hand, and
they renamed the GitHub repository and the local folder themselves.

## 8. Documentation and hardening

`AGENTS.md` (imported by `CLAUDE.md`) and `docs/DESIGN.md` were written. The user then asked for
all of the outstanding suggestions:

- an MIT licence
- a committed screenshot script (`scripts/screenshots/take.mjs`)
- a "zimone away" indicator, so a reader can tell a busy tutor from a missing one
- a live end-to-end test

For the live test, a separate session ran `/zimone:open` on a scratch copy of the Git book while
this session played the reader in the browser. It answered a passage question in about two
seconds and added a gloss. It replied to a check answer and a chapter message. When chapter 2 was
marked finished, it wrote chapter 3 in about 36 seconds, adapted to a request for diagrams, and
updated `learner.md` and `plan.md`. Asked for friction, it reported four snags, all fixed in
0.4.0:

- it put the CLI command in a shell variable, which zsh doesn't split, and a wrapper wouldn't
  match the skill's pre-approval
- it wanted several reference docs at once
- it was puzzled by gaps in event ids
- it inserted glosses with a script instead of the Edit tool

Finally `docs/TESTING.md`, `docs/API.md`, `CHANGELOG.md` and this summary were written.

## 9. Workbooks, units and a generic model

The user felt "book" was too specific and asked for another term. Candidates included study,
course, inquiry, primer and folio; the user chose **workbook**, because it covers both "course"
and "notebook" without dictating the content. "Chapter" became **unit**, at least internally.

The user then asked to use the rename to re-evaluate the internal vocabulary, so that the API and
data model wouldn't bake in today's features. The review found the server knew what a check and a
confidence rating were, and had three thread kinds and four event types that were really one
thing: the user said something somewhere. The result, released as 0.5.0:

- **Threads with an optional anchor** instead of kinds: none (the unit's or workbook's own
  thread), a passage with a quote, or a whole block (where a check's answers go).
- **Messages with optional `fields`**, validated per block type in one table, `RESPONSE_FIELDS`.
- **Roles `user`, `agent`, `system`.** The user rejected "learner" as a role, to avoid baking in
  even that concept; the product name had also been a role value.
- **Two events**, `message` and `unit_state`. The user suggested a state enum over a `unit_done`
  event to keep options open; `done` is the only state so far.
- **Display terms in `workbook.json`**, so a workbook can show "chapter" (or anything else) on
  the page while everything underneath says "unit". This was the user's idea: "unit" throughout,
  with the surface configurable.

The user confirmed there were no real users, so it was another clean break: no migration, and a
state version bump to refuse old state. A second live tutoring test used a workbook whose terms
said "book" and "chapter". The session used those words on the page and in its replies, answered
within about 13 seconds, and wrote unit 3 to a diagram request. Its friction report led to
fetching one reference doc per call (several at once got truncated), resolving a contradiction
about when to say "it's coming", and documenting diagrams, `next_exists` and fence tags.

Finally the user's library folder moved from `~/books` to `~/zimone-library`, and the library
setting was written to the zimone plugin's data folder (the old setting had gone with the codie
uninstall).

## Lessons for future sessions

- **Check which server you're talking to.** Early on, a test assumed port 4317 and opened the
  user's real book instead of the demo, clearing that origin's browser storage. Ports are now
  taken from `zimone url`, and AGENTS.md says so.
- **Monitor notifications truncate long lines**, so event payloads put short fields first.
- **A restarted server can reuse event ids**, which silently dropped events until the watcher
  learned to reset on a new server `instance`.
- **`[hidden]` loses to CSS `display` rules**; the stylesheet forces `[hidden]{display:none!important}`.
- **zsh doesn't word-split variables**; use functions in test scripts, and tell agents to write
  commands out.
- **Backgrounding `zimone watch` with `&` hangs the Bash tool**; run it under `timeout`.
- **A renamed repo folder breaks a local marketplace install**; remove and re-add the
  marketplace from the new path.
- **The plugin's own sessions are the best testers.** Both live tutoring runs found problems that
  no amount of API-level testing would have. Always ask for a friction report.
- **Long tool output gets cut short.** A test session fetching several reference docs at once
  lost the middle of them; the skills now fetch one per call.
- **The browser pane's `javascript_tool` gives up after 45 seconds**, so waiting on an agent's
  reply has to be split across calls.
- **Plugin settings vanish on uninstall.** `${CLAUDE_PLUGIN_DATA}` is per plugin and marketplace,
  so renaming the plugin (codie to zimone) silently dropped the library setting.
- **Name the vocabulary before the API sets it.** Thread kinds and events named after each
  learning feature had to be unpicked; the generic model is in API.md and AGENTS.md now.

## Left open

- Claude Code channels, once they leave preview, would remove the Monitor's re-arming.
- A `zimone gloss` command was suggested by the test session but not built; the reference now
  says to use the Edit tool.
- The user's `relational` book in `~/zimone-library` predates 0.5.0 and isn't recognised as a
  workbook; it was test material and was left as is.
