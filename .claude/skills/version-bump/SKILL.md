---
name: version-bump
description: For developing zimone itself, not for zimone users. Use before committing or pushing changes under plugins/zimone/ (skills, reference docs, runtime, reader shell). Decides whether the plugin version must be bumped and by how much, so installed users are offered the change.
---

# Bumping the zimone plugin version

`plugins/zimone/.claude-plugin/plugin.json` sets `version`. Users who installed zimone from the
marketplace stay on that version until it changes, so **an unbumped change never reaches them**.
This repo's own development install reads straight from the checkout and isn't affected, which
makes a forgotten bump easy to miss.

## When to bump

Bump once per push. Before pushing, check whether `plugins/zimone/` changed since the last bump:

```bash
last=$(git log -1 --format=%H -G'"version"' -- plugins/zimone/.claude-plugin/plugin.json)
git log --oneline "$last"..HEAD -- plugins/zimone/
```

If that lists commits with meaningful changes, add the bump to this push. Don't bump for
changes outside `plugins/zimone/` (README, `examples/`, `.claude/`, repo tooling), or for
comment-only edits.

## How much (0.x semver)

- **Minor** (`0.2.0` → `0.3.0`): new features, commands, events or skill behaviour. Also any
  change to the HTTP API between the reader page and the server, because an old server running
  alongside an updated page breaks. Also a change to the workbook format or `.zimone/state.json`
  (see below).
- **Patch** (`0.2.0` → `0.2.1`): bug fixes, styling, and wording changes to skills or reference
  docs that don't change what zimone does.

Take the larger bump if a push mixes both.

## Format changes need more than a bump

If a change alters what's stored in a workbook (`workbook.json`, the unit format, or
`.zimone/state.json`) so that older workbooks or state would be misread:

- Bump `WORKBOOK_FORMAT` in `runtime/lib/workbook.mjs`, or `STATE_VERSION` in `runtime/lib/server.mjs`.
- Add a migration for existing workbooks, or a clear error that says what to do. Never silently
  reinterpret old data.
- Mention the change in the bump's commit message.

## Doing it

1. Edit `version` in `plugins/zimone/.claude-plugin/plugin.json`, and add an entry at the top of
   `CHANGELOG.md` saying what the release gives users.
2. Run `claude plugin validate .` and confirm it passes.
3. Commit both on `main` as `Bump zimone to X.Y.Z`. In the body, summarise what the release contains
   for users.
4. Push only when the user says to. When asking to push, say that the push includes the bump
   and why it's a minor or patch.
