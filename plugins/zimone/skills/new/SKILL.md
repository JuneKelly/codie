---
name: new
description: Start a zimone "book you can talk to" — an adaptive course the user reads in the browser and can question passage by passage. Use when the user asks for a zimone book, or asks to be taught a topic as a course or book. Works inside an empty or book folder, or from any other project, where it commissions the book in a separate folder.
argument-hint: "[topic]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/zimone.mjs *)
---

# /zimone:new

Topic seed from the user: $ARGUMENTS

In this skill and in the reference docs it points to, `$ZIMONE` means
`node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/zimone.mjs`. Reference docs are printed by `$ZIMONE docs <name>`; don't read plugin files directly, since they're usually outside this session's folder.
Read the book reference (`$ZIMONE docs book`) before creating any book files.

## Pick the mode

Run `$ZIMONE detect .` and follow the matching section:

| Result | Mode |
|---|---|
| `book` | This folder is already a book. Tell the user, and suggest `/zimone:open`. Stop. |
| `brief` | This book was commissioned from another session. Read the planning reference (`$ZIMONE docs planning`) and follow it from **Continue from a brief**, with `.` as the book. (`/zimone:open` does the same.) |
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
3. **Choose where the book goes.** Run `$ZIMONE library "${CLAUDE_PLUGIN_DATA}"`.
   - **`library: unset`**: ask the user where books should live, suggesting `~/zimone-books`.
     Save their answer with `$ZIMONE library "${CLAUDE_PLUGIN_DATA}" --set <path>`, which also
     creates the folder.
   - **Then** offer `<library>/<slug>` (recommended), a subfolder of this project, or another
     path. The slug is lowercase and hyphenated. Check the choice with `$ZIMONE detect <path>`:
     if it's anything other than `missing` or `empty`, stop and ask.
   - Writing into the book folder will ask the user's permission, because it's outside this
     session's folder. Say so before you start.
4. **Choose context to copy.** If material from this project would make the book better (a
   schema, a failing query, a config, a short code excerpt), list each item with a one-line
   reason and ask which to include. It may be private work, so copy only what they approve.
   Copy into `<book>/context/`, trimmed to what matters, with a first-line comment giving the
   source path and date.
5. **Write the brief.** Create `<book>/brief.md` in the brief format from the book reference,
   plus `<book>/.gitignore` containing `.zimone/`. Put everything you didn't settle under
   **Still to settle**.
6. **Hand off.** The book is written and taught in its own session, started in the book folder.
   - If you have a tool that starts a new Claude Code session in a given folder, offer to use
     it, with the prompt `/zimone:open`.
   - Otherwise give the command: `cd "<book>" && claude "/zimone:open"`.

   Tell the user that `/zimone:open` in that folder picks up the brief, and that it's also the
   command for every later visit.

   Then go back to what the user was doing before.

## Write here (empty folder)

Run the full interview, at most three short rounds. Use AskUserQuestion for choices and ask
open questions in plain chat:

1. **Goal** (open): what they want to be able to *do* afterwards, and why now.
2. **Diagnostic** (open): 2–3 short probe questions that test the prerequisites, rather than
   asking for a self-rating. Judge the answers kindly, and say briefly what they tell you.
3. **Shape** (one AskUserQuestion call): time per week and overall length; relationship to
   sources (primary-led / commentary-led / mixed); tone; how much active learning. Ask about
   a specific edition only if they want to read primary texts.

Then read the planning reference (`$ZIMONE docs planning`) and follow it from **Plan and write**,
with `.` as the book.
