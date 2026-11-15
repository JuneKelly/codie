---
name: version-bump
description: For developing codie itself, not for codie users. Use before committing or pushing changes under plugins/codie/ (skills, reference docs, runtime, reader shell). Decides whether the plugin version must be bumped and by how much, so installed users are offered the change.
---

# Bumping the codie plugin version

`plugins/codie/.claude-plugin/plugin.json` sets `version`. Users who installed codie from the
marketplace stay on that version until it changes, so **an unbumped change never reaches them**.
This repo's own development install reads straight from the checkout and isn't affected, which
makes a forgotten bump easy to miss.

## When to bump

Bump once per push. Before pushing, check whether `plugins/codie/` changed since the last bump:

```bash
last=$(git log -1 --format=%H -G'"version"' -- plugins/codie/.claude-plugin/plugin.json)
git log --oneline "$last"..HEAD -- plugins/codie/
```

If that lists commits with meaningful changes, add the bump to this push. Don't bump for
changes outside `plugins/codie/` (README, `examples/`, `.claude/`, repo tooling), or for
comment-only edits.

## How much (0.x semver)

- **Minor** (`0.2.0` → `0.3.0`): new features, commands, events or skill behaviour. Also any
  change to the HTTP API between the reader page and the server, because an old server running
  alongside an updated page breaks. Also a change to the book format or `.codie/state.json`
  (see below).
- **Patch** (`0.2.0` → `0.2.1`): bug fixes, styling, and wording changes to skills or reference
  docs that don't change what codie does.

Take the larger bump if a push mixes both.

## Format changes need more than a bump

If a change alters what's stored in a book (`book.json`, the chapter format, or
`.codie/state.json`) so that older books or state would be misread:

- Bump `BOOK_FORMAT` in `runtime/lib/book.mjs`, or the state `version` in `runtime/lib/server.mjs`.
- Add a migration for existing books, or a clear error that says what to do. Never silently
  reinterpret old data.
- Mention the change in the bump's commit message.

## Doing it

1. Edit `version` in `plugins/codie/.claude-plugin/plugin.json`.
2. Run `claude plugin validate .` and confirm it passes.
3. Commit on `main` as `Bump codie to X.Y.Z`. In the body, summarise what the release contains
   for users.
4. Push only when the user says to. When asking to push, say that the push includes the bump
   and why it's a minor or patch.
