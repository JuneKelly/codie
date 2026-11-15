# AGENTS.md

Guidance for agents working on zimone itself. For what zimone is and how people use it, read
[README.md](README.md).

zimone is a Claude Code plugin. A live Claude session interviews a learner, writes a course as a
folder of Markdown chapters (a "book"), and serves it to the browser. Reader questions, check
answers and finished chapters flow back to that session through a Monitor running
`zimone watch`. The plugin was called codie until 0.3.0.

## Layout

| Path | What it is |
|---|---|
| `.claude-plugin/marketplace.json` | Makes this repo a one-plugin marketplace (`zimone-marketplace`) |
| `plugins/zimone/.claude-plugin/plugin.json` | Plugin manifest; `version` gates what installed users get |
| `plugins/zimone/skills/{new,open}/SKILL.md` | `/zimone:new` and `/zimone:open` |
| `plugins/zimone/reference/` | Instructions the teaching session reads: `book.md` (format and authoring), `planning.md`, `serving.md` (event handling) |
| `plugins/zimone/runtime/bin/zimone.mjs` | The CLI the skills call |
| `plugins/zimone/runtime/lib/` | `book.mjs` (loading, folder detection), `render.mjs` (chapter splitting, validation, Markdown), `server.mjs` (HTTP, SSE, state, event queue) |
| `plugins/zimone/runtime/shell/` | The reader page (`index.html`, `zimone.js`, `zimone.css`) |
| `plugins/zimone/runtime/vendor/markdown-it/` | Vendored parser; see its `SOURCE.md` |
| `examples/demo/` | "How Git Actually Works", a sample book (two chapters written, two planned) |
| `docs/screenshots/` | README images, taken from `examples/demo` |
| `.claude/skills/version-bump/` | Project skill: when and how to bump the plugin version |

## Commands

Run from the repo root. Node 20 or later; there is no install step and no `package.json`.

```bash
claude plugin validate .                                          # manifests and skills
node plugins/zimone/runtime/bin/zimone.mjs check examples/demo    # book and chapter validation
node plugins/zimone/runtime/bin/zimone.mjs serve examples/demo    # try the reader (run in background)
node plugins/zimone/runtime/bin/zimone.mjs url examples/demo      # the URL that server is on
```

There is no automated test suite. Validate changes by running the CLI against a scratch copy of
`examples/demo`: post to the HTTP API (as the page would), then exercise `watch`, `reply`, `say`,
`ack` and `thread`, and look at the page in a browser for UI changes.

## Rules

- **Find the test server's port with `zimone url`.** Servers take the first free port from 4317,
  and the user's real books (for example `~/books/…`) may already be running there. Never post
  to, clear storage for, or screenshot a port you haven't confirmed is your test server. Test on
  a copy in a scratch folder, so `.zimone/` state doesn't land in `examples/demo`.
- **Never touch the user's real books** unless asked.
- **No runtime dependencies.** Node's standard library only. markdown-it is the one exception and
  is vendored unmodified; upgrade it as `SOURCE.md` describes.
- **Keep the server local and strict.** It binds to 127.0.0.1, rejects foreign `Host` and
  `Origin` headers, and accepts only JSON POSTs, so other websites can't inject events into the
  user's session. Don't loosen any of that.
- **Rendered chapter HTML must stay stable.** Reader questions are anchored to block ids and the
  exact quoted text. A renderer change that alters a chapter's text (even whitespace) can detach
  existing threads; compare `examples/demo` output before and after.
- **Watcher output is read through Monitor notifications, which truncate long lines.** Keep short
  fields first and long text last in event payloads.
- **Skills reach plugin files only through the CLI.** The teaching session usually runs outside
  the plugin folder and can't read it directly, so reference docs come from `zimone docs <name>`
  and settings from `zimone library`. The skills pre-approve
  `Bash(node ${CLAUDE_PLUGIN_ROOT}/runtime/bin/zimone.mjs *)`; new agent-facing features belong
  behind that CLI too.
- **Stored formats don't change silently.** If `book.json`, the chapter format or
  `.zimone/state.json` changes so that older data would be misread, bump `BOOK_FORMAT` in
  `book.mjs` or the state `version` in `server.mjs`, and add a migration or a clear error.
- **Never suppress errors or default missing required data.** Missing or invalid book data is an
  error with a message that says what to fix.

## Writing

The skills and reference docs are prompts for another Claude session. Write them as plain,
direct instructions: say what to do and when, and keep them short. The README and these docs use
"zimone" in lowercase, like a command.

## Git and releases

- Commit directly to `main`; no feature branches. Commit as you go.
- Push only when the user says so.
- Before pushing changes under `plugins/zimone/`, follow the `version-bump` skill: installed users
  don't receive a change until `version` in `plugin.json` is bumped. Bump in its own commit,
  `Bump zimone to X.Y.Z`.
- If a UI change makes the README screenshots out of date, retake them from a scratch copy of
  `examples/demo` at 1280×800, 2× scale.
