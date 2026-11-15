---
name: open
description: Open a codie book — serve it in the browser and answer the reader's questions, check answers and chapter completions live in this session. Also picks up a commissioned book (a folder with brief.md) and plans it first. Use when the user wants to read, resume, continue or start reading a codie book.
argument-hint: "[book folder, default: current folder]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/codie.mjs *)
---

# /codie:open

Book folder from the user: $ARGUMENTS (if empty, use the current folder, `.`)

In this skill and in the reference docs it points to, `$CODIE` means
`node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/codie.mjs`. Reference docs are printed by `$CODIE docs <name>`; don't read plugin files directly, since they're usually outside this session's folder.

1. Run `$CODIE detect <book>`. If the book folder isn't this session's working folder, say
   that edits there may need approval, and that starting a session inside the book folder
   avoids this.
   - **`book`**: continue with step 2.
   - **`brief`**: the book was commissioned but hasn't been planned yet. Read the book
     reference (`$CODIE docs book`) and the planning reference (`$CODIE docs planning`), and
     follow the planning reference from **Continue from a brief**. That ends with the book
     being served. Don't do steps 2–4.
   - **Anything else**: say it isn't a codie book, suggest `/codie:new`, and stop.
2. Run `$CODIE check <book>`. If it reports errors, fix them before serving.
3. Read the book reference (`$CODIE docs book`), then the book's `plan.md` and `learner.md`.
   Read `brief.md` and `context/` too, if present. That's your picture of the reader.
4. Read the serving reference (`$CODIE docs serving`) and follow it. Then give the user a
   one-paragraph orientation: where they are in the syllabus, how they're doing against the
   objectives, and which chapter to read next.
