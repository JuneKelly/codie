---
name: new
description: Start a codie "book you can talk to" — an adaptive course the user reads in the browser and can question passage by passage. Use when the user asks for a codie book, or asks to be taught a topic as a course or book. Works inside an empty or book folder, or from any other project, where it commissions the book in a separate folder.
argument-hint: "[topic]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/codie.mjs *)
---

# /codie:new

Topic seed from the user: $ARGUMENTS

In this skill and in the reference files it points to, `$CODIE` means
`node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/codie.mjs`, and the plugin root is `${CLAUDE_PLUGIN_ROOT}`.
Read `${CLAUDE_PLUGIN_ROOT}/reference/book.md` before creating any book files.

## Pick the mode

Run `$CODIE detect .` and follow the matching section:

| Result | Mode |
|---|---|
| `book` | This folder is already a book. Tell the user, and suggest `/codie:open`. Stop. |
| `brief` | **Continue from a brief**: this book was commissioned from another session. |
| `empty` | **Write here**: this folder becomes the book. |
| `other` | **Commission**: this session is about something else. Write a brief into a new book folder and hand off. |

If the user said explicitly where the book should go, that overrides the table. For example,
"make the book here" in a non-empty folder means create it in a subfolder they agree on.

## Commission (from another project)

The user is in the middle of other work, so keep this short: at most two rounds of questions.
Do not write chapters in this session.

1. **Use what you already know.** From this conversation, work out: the topic, why they need it
   now, what they seem to know already (with evidence), and what would make the book directly
   useful to their work. Summarise that in 2–4 sentences and ask them to correct it.
2. **Fill the gaps** with one AskUserQuestion call (up to four questions): the goal if it's
   still unclear, time per week and overall length, tone, and how much active learning
   (light / regular / heavy checks). Skip anything already known.
3. **Choose where the book goes.** Read `${CLAUDE_PLUGIN_DATA}/config.json` for a `library`
   path.
   - **No library yet**: ask the user where books should live, suggesting `~/codie-books`.
     Then write `{"library": "<absolute path>"}` to that file, creating the folder.
   - **Then** offer `<library>/<slug>` (recommended), a subfolder of this project, or another
     path. The slug is lowercase and hyphenated.
   - If the destination exists and isn't empty, stop and ask.
4. **Choose context to copy.** If material from this project would make the book better (a
   schema, a failing query, a config, a short code excerpt), list each item with a one-line
   reason and ask which to include. It may be private work, so copy only what they approve.
   Copy into `<book>/context/`, trimmed to what matters, with a first-line comment giving the
   source path and date.
5. **Write the brief.** Create `<book>/brief.md` in the brief format from `reference/book.md`,
   plus `<book>/.gitignore` containing `.codie/`. Put everything you didn't settle under
   **Still to settle**.
6. **Hand off.** The book is written and taught in its own session, started in the book folder.
   - If you have a tool that starts a new Claude Code session in a given folder, offer to use
     it, with the prompt `/codie:new`.
   - Otherwise give the command: `cd "<book>" && claude "/codie:new"`.

   Then go back to what the user was doing before.

## Continue from a brief

1. Read `brief.md` and everything in `context/`.
2. Confirm the goal in one line, and ask only what's under **Still to settle**, with one
   AskUserQuestion call. If the brief's evidence about their level is thin, add one or two
   short diagnostic questions in chat.
3. Go to **Plan and write**.

## Write here (empty folder)

Run the full interview, at most three short rounds. Use AskUserQuestion for choices and ask
open questions in plain chat:

1. **Goal** (open): what they want to be able to *do* afterwards, and why now.
2. **Diagnostic** (open): 2–3 short probe questions that test the prerequisites, rather than
   asking for a self-rating. Judge the answers kindly, and say briefly what they tell you.
3. **Shape** (one AskUserQuestion call): time per week and overall length; relationship to
   sources (primary-led / commentary-led / mixed); tone; how much active learning. Ask about
   a specific edition only if they want to read primary texts.

Then go to **Plan and write**.

## Plan and write

1. In the book folder, create `book.json`, `plan.md` and `learner.md` as described in
   `reference/book.md`, and a `.gitignore` containing `.codie/` if there isn't one. Fill
   `learner.md`'s **Motivation** from the brief or the interview.
2. Present the aim, objectives and syllabus in chat. Ask for approval with AskUserQuestion
   (approve / adjust), and revise until approved. Don't write chapters before approval.
3. Write chapter one, following `reference/book.md`, and run `$CODIE check . <id>` until it
   passes.
4. Serve the book: read `${CLAUDE_PLUGIN_ROOT}/reference/serving.md` and follow it, with `.` as
   the book. Keep handling reader events for the rest of the session.
