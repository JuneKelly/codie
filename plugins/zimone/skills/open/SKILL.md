---
name: open
description: Open a zimone workbook — serve it in the browser and answer the user's questions, check answers and finished units live in this session. Also picks up a commissioned workbook (a folder with brief.md) and plans it first. Use when the user wants to read, resume, continue or start a zimone workbook.
argument-hint: "[workbook folder, default: current folder]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/zimone.mjs *)
---

# /zimone:open

Workbook folder from the user: $ARGUMENTS (if empty, use the current folder, `.`)

In this skill and in the reference docs it points to, `$ZIMONE` stands for
`node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/zimone.mjs`. Write that command out in full every time.
Don't put it in a shell variable or function: zsh won't split a variable, and a wrapper isn't
covered by this skill's pre-approval. Reference docs are printed by `$ZIMONE docs <name>...`
(several names at once is fine); don't read plugin files directly, since they're usually outside
this session's folder.

1. Run `$ZIMONE detect <workbook>`. If the workbook folder isn't this session's working folder,
   say that edits there may need approval, and that starting a session inside the workbook folder
   avoids this.
   - **`workbook`**: continue with step 2.
   - **`brief`**: the workbook was commissioned but hasn't been planned yet. Read the workbook
     and planning references (`$ZIMONE docs workbook planning`), and follow the planning
     reference from **Continue from a brief**. That ends with the workbook being served. Don't do
     steps 2–4.
   - **Anything else**: say it isn't a zimone workbook, suggest `/zimone:new`, and stop.
2. Run `$ZIMONE check <workbook>`. If it reports errors, fix them before serving.
3. Read the workbook reference (`$ZIMONE docs workbook`), then the workbook's `plan.md` and
   `learner.md`. Read `brief.md` and `context/` too, if present. That's your picture of the user.
4. Read the serving reference (`$ZIMONE docs serving`) and follow it. Then give the user a
   one-paragraph orientation: where they are in the syllabus, how they're doing against the
   objectives, and which unit to work on next (in the workbook's own terms).
