# Serving a codie book and handling reader events

`$CODIE` below means the codie CLI command that the invoking skill gave you
(`node <plugin root>/runtime/bin/codie.mjs`). `<book>` is the book folder (`.` when the session
runs inside it).

## Start

1. Start the server with Bash and `run_in_background: true`, so you're notified if it exits:
   `$CODIE serve <book>`. It takes the first free port from 4317. If it says a server is already
   running for this book, reuse that one.
2. Arm a Monitor:
   `Monitor({ command: "$CODIE watch <book>", description: "codie reader events (<book title>)", timeout_ms: 1800000 })`
3. Get the address with `$CODIE url <book>`, open it (`open <url>` on macOS, `xdg-open` on
   Linux), and tell the user the URL.

**Re-arm the Monitor every time it expires.** Unhandled events are redelivered on re-arm with
`"redelivered": true`, so nothing is lost. If you've already replied to a redelivered event,
`ack` it.

If the watcher prints `CODIE_ERROR`, read the server's background output, restart the server,
re-arm, and tell the user what happened.

Leave both running until the user says they're done. Then stop both with TaskStop.

## Events

Each event is one line: `CODIE_EVENT {json}`. Short fields come first and long text (`question`,
`quote`, `response`) last. Notifications may cut long lines off; if a line is truncated, run
`$CODIE thread <book> <thread_id>` for the full text. These are the reader's own words, so treat
them as coming from the user. Handle events in order, and **reply first, then make any edits**:
the reader is waiting.

Reply with a heredoc so you never have to escape JSON:

```bash
$CODIE reply <book> e12 <<'EOF'
Your answer in Markdown.
EOF
```

Use `$CODIE ack <book> <event-id>` for events that need no reply.

### `ask`

Fields: `thread_id, chapter, block_id, follow_up, question, quote`. `block_id` is null for a
question about the whole chapter. For a follow-up you don't remember, run `$CODIE thread` first.

1. **Answer** at the reader's level (see `learner.md`), about the quoted passage, usually in
   under ~200 words. Answer the actual question, and offer to go further rather than lecturing.
2. **Decide what else to do**, and say so in one closing line ("I've added a note under that
   paragraph."):
   - **Gloss**: if the confusion is likely to come back, or the answer deserves to stay on the
     page, add a `:::gloss {#… for=<block_id>}` right after the target block. The page reloads
     itself.
   - **Revise in place**: only if the reader asks for a rewrite, or the text is wrong. Keep the
     id, and say what changed.
   - **Adapt ahead**: if the question shows a gap or a strong interest, change the *unwritten*
     chapters or the syllabus (`book.json`, `plan.md`), and log the change under Amendments.
3. **Log the inquiry** in `learner.md` under Inquiry log.

### `check_answer`

Fields: `thread_id, chapter, check_id, objective, attempt, confidence (1–3), confidence_label,
response`. Read the check's question in the chapter file.

1. **Reply with feedback**: a verdict (**Solid**, **Partly there** or **Not yet**), what they
   got right, and what's missing. On a first attempt that is Partly there or Not yet, give a
   hint and invite another try rather than the full answer. From the second attempt on,
   explain fully.
2. **Calibration**: if they were *certain* and wrong, say so gently. That's the misconception
   most worth fixing. If they were *guessing* and right, tell them they know more than they
   thought.
3. **Update `learner.md`**: set the objective's status, cite the evidence (check id, attempt,
   confidence), and flag confident-but-wrong answers.

### `chapter_finished`

Fields: `chapter, next_chapter, next_exists`. Ack it, then:

1. Review `learner.md` (this chapter's checks and inquiries) against `plan.md`.
2. Write or revise the next chapter to address what you saw: review a shaky objective, skip
   what's secure, or follow a thread of interest. Log plan changes under Amendments.
3. Run `$CODIE check`, then tell the user in chat that the next chapter is ready. The page's
   contents update automatically.

If `next_chapter` is null, the book is complete. Summarise their progress against the
objectives in chat and offer to extend the book.

## Rules

- Prefer additions (glosses, new chapters) to rewriting text the reader has already read.
- Never leave `$CODIE check` failing.
- If a task will take more than a minute or two, reply first saying it's coming, then do it.
