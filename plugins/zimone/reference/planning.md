# Planning and writing a zimone book

`$ZIMONE` below means the zimone CLI command that the invoking skill gave you
(`node <plugin root>/runtime/bin/zimone.mjs`). `<book>` is the book folder (`.` when the session
runs inside it). Read the book reference (`$ZIMONE docs book`) first.

## Continue from a brief

Use this for a folder that has a `brief.md` but no `book.json`: the book was commissioned from
another session and hasn't been planned yet.

1. Read `brief.md` and everything in `context/`.
2. Confirm the goal in one line, and ask only what's under **Still to settle**, with one
   AskUserQuestion call. If the brief's evidence about their level is thin, add one or two
   short diagnostic questions in chat.
3. Go to **Plan and write**.

## Plan and write

1. In the book folder, create `book.json`, `plan.md` and `learner.md` as described in the book
   reference, and a `.gitignore` containing `.zimone/` if there isn't one. Fill `learner.md`'s
   **Motivation** from the brief or the interview. Keep `brief.md` as the record of how the
   book started.
2. Present the aim, objectives and syllabus in chat. Ask for approval with AskUserQuestion
   (approve / adjust), and revise until approved. Don't write chapters before approval.
3. Write chapter one, following the book reference, and run `$ZIMONE check <book> <id>` until it
   passes.
4. Serve the book: read the serving reference (`$ZIMONE docs serving`) and follow it. Keep
   handling reader events for the rest of the session.
