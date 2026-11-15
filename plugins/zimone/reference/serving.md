# Serving a zimone workbook and handling user events

`$ZIMONE` below means the zimone CLI command that the invoking skill gave you
(`node <plugin root>/runtime/bin/zimone.mjs`). `<workbook>` is the workbook folder (`.` when the
session runs inside it).

**Words.** These docs say "workbook" and "unit". If `workbook.json` has `terms`, the user sees
those words instead (for example "book" and "chapter"), so use them whenever you talk to the user.

## Start

1. Start the server with Bash and `run_in_background: true`, so you're notified if it exits:
   `$ZIMONE serve <workbook>`. It takes the first free port from 4317. If it says a server is
   already running for this workbook, reuse that one.
2. Arm a Monitor:
   `Monitor({ command: "$ZIMONE watch <workbook>", description: "zimone events (<workbook title>)", timeout_ms: 1800000 })`
3. Get the address with `$ZIMONE url <workbook>`, open it (`open <url>` on macOS, `xdg-open` on
   Linux), and tell the user the URL.

**Re-arm the Monitor every time it expires.** Unhandled events are redelivered on re-arm with
`"redelivered": true`, so nothing is lost. If you've already replied to a redelivered event,
`ack` it. While no Monitor is running, the page tells the user that nobody is watching.

If the watcher prints `ZIMONE_ERROR`, read the server's background output, restart the server,
re-arm, and tell the user what happened.

Leave both running until the user says they're done. Then stop both with TaskStop.

## Events

Each event is one line: `ZIMONE_EVENT {json}`. Short fields come first and long text (`text`,
`quote`) last. Notifications may cut long lines off; if a line is truncated, run
`$ZIMONE thread <workbook> <thread_id>` for the full text. Event ids share a counter with thread
ids, so gaps between them are normal. These are the user's own words. Handle events in order, and
**reply first, then make any edits**: the user is waiting.

Reply with a heredoc so you never have to escape JSON:

```bash
$ZIMONE reply <workbook> e12 <<'EOF'
Your answer in Markdown.
EOF
```

Use `$ZIMONE ack <workbook> <event-id>` for events that need no reply.

To post without being asked, use `post`. It goes into a unit's thread (`--unit <id>`) or, without
the flag, the workbook's thread, which shows on the contents page:

```bash
$ZIMONE post <workbook> --unit 02-indexes <<'EOF'
Preparing unit 3. Your check on O2 was shaky, so it opens with a short review.
EOF
```

**The page is the user's main channel**, so put updates and questions meant for them there, not
in the terminal. Keep `post` to milestones and decisions; don't narrate routine work. Link to a
unit with `[Title](/u/<unit-id>)`.

### `message`

Fields: `thread_id, unit, block, block_type, block_attrs, turn, fields, text, quote`. Everything
the user writes arrives as a `message`. Where it was written tells you what it is:

| `unit` | `block` | `quote` | What it is |
|---|---|---|---|
| null | null | null | The workbook's thread: about the whole workbook |
| set | null | null | The unit's thread: about the unit as a whole |
| set | set | set | A question about a passage the user selected |
| set | set (`block_type` `check`) | null | An answer to a check |

`turn` counts the user's messages in the thread, so `turn > 1` is a follow-up; if you don't
remember the thread, run `$ZIMONE thread` first.

**A question about a passage:**

1. **Answer** at the user's level (see `learner.md`), about the quoted passage, usually in under
   ~200 words. Answer the actual question, and offer to go further rather than lecturing.
2. **Decide what else to do**, and say so in one closing line ("I've added a note under that
   paragraph."):
   - **Gloss**: if the confusion is likely to come back, or the answer deserves to stay on the
     page, add a `:::gloss {#… for=<block>}` right after the target block, using your Edit tool
     on the unit file. The page reloads itself.
   - **Revise in place**: only if the user asks for a rewrite, or the text is wrong. Keep the id,
     and say what changed.
   - **Adapt ahead**: if the question shows a gap or a strong interest, change the *unwritten*
     units or the syllabus (`workbook.json`, `plan.md`), and log the change under Amendments.
3. **Log the inquiry** in `learner.md` under Inquiry log.

**A message in a unit's or the workbook's thread:** chat about the unit or the workbook, a
request ("more examples please"), feedback, or "I'm stopping for today". Reply conversationally
and act on requests. If it changes the plan or the unwritten units, log it under Amendments in
`plan.md` and say what you changed. Note anything it tells you about the user in `learner.md`.
If you need the user to decide something (say, whether to add a unit), ask in the thread with
`post` rather than in the terminal, and act on their reply.

**An answer to a check:** `fields.confidence` is 1 (guessing), 2 (fairly sure) or 3 (certain),
and `block_attrs.objective` is the objective it tests. Read the check's question in the unit file.

1. **Reply with feedback**: a verdict (**Solid**, **Partly there** or **Not yet**), what they got
   right, and what's missing. On a first attempt (`turn` 1) that is Partly there or Not yet, give
   a hint and invite another try rather than the full answer. From the second attempt on,
   explain fully.
2. **Calibration**: if they were *certain* and wrong, say so gently. That's the misconception most
   worth fixing. If they were *guessing* and right, tell them they know more than they thought.
3. **Update `learner.md`**: set the objective's status, cite the evidence (check id, attempt,
   confidence), and flag confident-but-wrong answers.

### `unit_state`

Fields: `thread_id, unit, state, next_unit, next_exists`. The user changed a unit's state; today
the only state is `done`. The thread is that unit's thread, where the user is waiting. Writing a
unit takes a while, so step 2's `post` is your "it's coming" message, and the `reply` in step 4
comes when the unit is ready.

1. Review `learner.md` (this unit's checks and inquiries) against `plan.md`.
2. `post` into that unit's thread, in one or two sentences, what the next unit will do
   differently because of how this one went, or that it'll follow the plan as is.
3. Write the next unit (or, if `next_exists` is true because it was written earlier, revise it)
   to address what you saw: review a shaky objective, skip what's secure, or follow a thread of
   interest. Log plan changes under Amendments.
4. Run `$ZIMONE check`, then `reply` to the event with a link: `[<title>](/u/<next_unit>) is
   ready.` The contents page updates automatically.

If `next_unit` is null, the workbook is complete. Reply with a short summary of their progress
against the objectives, and offer to extend the workbook.

## Rules

- Prefer additions (glosses, new units) to rewriting text the user has already read.
- Never leave `$ZIMONE check` failing.
- For a `message` that will take more than a minute or two to act on, reply first saying it's
  coming, then do it.
