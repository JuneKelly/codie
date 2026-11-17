---
name: verify
description: For developing zimone itself, not for zimone users. Use after making changes in this repo and before committing or pushing. Runs scripts/verify.mjs, which runs the automatable checks that match the diff and lists the manual ones still owed.
---

# Verifying a zimone change

There is no test suite. `scripts/verify.mjs` runs the checks that can be automated for the files
that changed (uncommitted, untracked and unpushed) and lists the rest. The commands and traps for
the manual checks are in [docs/TESTING.md](../../../docs/TESTING.md).

## 1. Run the script

```bash
node scripts/verify.mjs
```

It runs, when the diff calls for them: `claude plugin validate .`, `zimone check examples/demo`,
`node --check` on changed runtime scripts, and a renderer stability comparison (the rendered HTML
of every `examples/demo` unit against the upstream baseline, or `HEAD` with no upstream). It then
prints "Manual checks still owed" and notes. Exit status 1 means a check failed.

A failed renderer stability check means existing user threads could detach. Justify the change
or fix it.

## 2. Do the manual checks it lists

Each one is described in `docs/TESTING.md`. Work on a scratch copy of `examples/demo`, never on the
demo or the user's workbooks, and confirm the port with `zimone url` first.

The **live tutoring test** spawns a separate session, so tell the user before starting it. Always
ask that session for a list of anything unclear or awkward, and read its full report.

## 3. Close out

- Fix failures, then rerun `node scripts/verify.mjs` and anything the fix could affect.
- Follow the script's notes (`docs/API.md`, `version-bump`).
- Report: **ran** (check, result), **failed** (output), **skipped** (and why). A change is not
  verified while a listed manual check is skipped; say so.
