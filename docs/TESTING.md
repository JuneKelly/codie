# Testing zimone

There is no automated test suite. These are the manual checks that have worked, and the traps
that have cost time. Pick the checks that match what you changed; the HTTP API is described in
[API.md](API.md).

## Ground rules

- **Test on a scratch copy**, never on `examples/demo` itself (the server would write `.zimone/`
  into it) and never on the user's real workbooks.
- **Get the port from `zimone url`.** Each server takes the first free port from 4317, and the
  user may have a real workbook open on 4317. Never post to, screenshot or clear storage for a port
  you haven't confirmed belongs to your test server.
- **Stop what you start.** Run servers with Bash `run_in_background: true` and stop them with
  TaskStop when done.

## Setup

In zsh a command stored in a variable isn't split into words, so `Z="node …"; $Z url` fails with
"no such file or directory". Write the command out, or use a function:

```bash
zi() { node plugins/zimone/runtime/bin/zimone.mjs "$@"; }
SCRATCH=<your scratchpad folder>
B="$SCRATCH/workbook"
rm -rf "$B" && cp -R examples/demo "$B"
```

Then, in the background: `node plugins/zimone/runtime/bin/zimone.mjs serve "$B"`. In the
foreground:

```bash
U=$(zi url "$B"); U=${U%/}  # waits for the server, prints e.g. http://127.0.0.1:4318/
```

## Static checks

```bash
claude plugin validate .                 # after touching manifests or skills
zi check examples/demo                   # after touching the renderer or the example workbook
node --check plugins/zimone/runtime/shell/zimone.js   # syntax, for the page script
```

**Renderer changes** must not change the text of existing units, because user questions
are anchored to it. Before and after the change, dump each unit's HTML and compare:

```bash
node -e 'import("./plugins/zimone/runtime/lib/workbook.mjs").then(({readUnit}) => {
  for (const id of ["01-snapshots", "02-branches"]) console.log(readUnit("examples/demo", id).html);
})' > "$SCRATCH/after.html"   # and before.html, then diff them
```

## Playing the user with curl

POSTs need `Content-Type: application/json`. Each one below creates an event, except a repeated
`done` for a unit whose earlier `unit_state` event is still unhandled.

```bash
post() { curl -s -X POST -H 'Content-Type: application/json' -d "$2" "$U$1"; echo; }
post /api/messages '{"unit":"01-snapshots","anchor":{"block":"c1-p02","quote":"a SHA-1 hash"},"text":"Why SHA-1?"}'
post /api/messages '{"unit":"01-snapshots","text":"Hello from the unit"}'
post /api/messages '{"text":"Hello from the contents page"}'
post /api/messages '{"unit":"01-snapshots","anchor":{"block":"c1-chk1"},"text":"Snapshots.","fields":{"confidence":2}}'
post /api/messages '{"thread_id":"t1","text":"A follow-up"}'
post /api/units/01-snapshots/state '{"state":"done"}'
curl -s "$U/api/threads?unit=01-snapshots"
curl -s "$U/api/threads?unit="          # the workbook's thread
```

The error paths are worth a pass too: a check answer without `fields`, `fields` on an ordinary
message, an anchor without a unit, and an unknown state should each return a 400 with a message
that says what's wrong.

## Playing the session with the CLI

```bash
timeout 4 zi watch "$B"                      # prints ZIMONE_EVENT lines, then stops
echo '**Answer**' | zi reply "$B" e2         # use an event id from the watch output
echo 'Unprompted note' | zi post "$B" --unit 01-snapshots
zi ack "$B" e5
zi thread "$B" t1
```

**Always run `watch` under `timeout`** (or as its own background task). It never exits on its own.
Started with `&` inside a compound command, it keeps the command's output open and the Bash call
hangs until its two-minute timeout.

Event ids share a counter with thread ids (`t1`, `e2`, `t3`, …), so gaps are normal. Events stay
unhandled, and are redelivered with `"redelivered": true`, until they get a `reply` or `ack`.

## In the browser

Use the built-in browser pane on the URL from `zimone url`. `javascript_tool` is the quickest way
to drive the page and read its state. It gives up after 45 seconds, so to wait for an agent's
reply (writing a unit takes a minute or more), poll in several calls of under 40 seconds each
rather than one long loop. For example:

```js
// Ask about a passage the way a user would: select text, click "Ask about this", submit.
const p = document.querySelector('[data-block-id="c2-p06"]');
const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
let n; while ((n = w.nextNode()) && !n.data.includes('only HEAD'));
const r = document.createRange(); const i = n.data.indexOf('only HEAD');
r.setStart(n, i); r.setEnd(n, i + 9);
getSelection().removeAllRanges(); getSelection().addRange(r);
document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
document.getElementById('cx-ask-sel').click();
document.getElementById('cx-compose-text').value = 'A question';
document.getElementById('cx-compose').requestSubmit();
```

Useful state: `#cx-conn` (header status: `live`, `zimone away`, `disconnected`), `.cx-thread`
cards (`data-open`), `.cx-status` (waiting text), `.cx-feedback` inside a check. Reload the page
after editing `zimone.js` or `zimone.css`; the server sends them with `no-store`.

To see "zimone away", serve with no watcher running; it shows once the page connects. Run
`timeout 4 zi watch "$B"` and the header turns `live` within a second, then back to away about
five seconds after the watcher stops.

## Screenshots

`node scripts/screenshots/take.mjs` retakes `docs/screenshots/*.png` (needs Google Chrome; set
`CHROME` if it isn't at the macOS default). It uses its own scratch copy and port. Unchanged UI
gives byte-identical images, or near enough, so a large diff means the UI changed.

## A live tutoring test

The strongest check, and the only one that tests the skills and reference docs, is a real
session tutoring a scratch workbook while you play the user. Each of the first two runs found
four or five real problems.

1. Copy `examples/demo` to a scratch folder and add a `.gitignore` containing `.zimone/`. Set
   `terms` in its `workbook.json` (say `"unit": ["chapter", "chapters"]`), so the same run checks
   that the page and the agent use the workbook's words.
2. Make sure the installed plugin reads from this checkout (`claude plugin list` shows
   `Read from: …/plugins/zimone`). If the repo folder moved, remove and re-add the marketplace
   (`claude plugin marketplace add ./`) and reinstall.
3. Start a separate session in the scratch folder (in the desktop app, `start_session` with
   `cwd`) whose prompt is `/zimone:open` plus "tutor the user on the page; keep serving until
   told to stop".
4. When it reports the workbook is served, confirm the port with `zimone url <scratch workbook>`,
   then act as the user in the browser: ask about a passage, answer a check, send a unit message,
   and mark a unit done.
5. Check the results: `zi check` passes for the new unit, `.zimone/state.json` has no
   unhandled events, and `learner.md` and `plan.md` record what happened.
6. Ask the session to stop its server and Monitor, and to list anything in the skill, the
   references or the CLI that was unclear or needed a workaround. Always ask: this report is
   where the problems show up. Read the full report with the session tools (the note you get
   when its turn ends is cut short), and fix what it reports.
