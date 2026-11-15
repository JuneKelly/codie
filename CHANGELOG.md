# Changelog

What each version of the plugin gave its users. Installed users get a change only when
`version` in `plugins/zimone/.claude-plugin/plugin.json` is bumped; see the `version-bump` skill.
Add an entry with each bump.

## 0.4.0

- The page shows **zimone away** when no session is watching the book, and waiting questions
  say how to start one. (New `tutor` event-stream message.)
- `zimone docs` accepts several names at once.
- Clearer skill and reference instructions, from a live tutoring test: write the CLI command out
  in full rather than in a shell variable, edit chapters with the Edit and Write tools, and
  expect gaps in event ids.
- MIT licence.

## 0.3.0

- **Renamed from codie to zimone.** The plugin is `zimone@zimone-marketplace`, the skills are
  `/zimone:new` and `/zimone:open`, and the repository is `JuneKelly/zimone`. Installs of
  `codie@codie-marketplace` don't update; install zimone instead.
- **Clean break for stored data:** books use `zimone_format` in `book.json` and a `.zimone/`
  state folder, and replies are stored with role `zimone`. A codie book is refused with a message
  naming the three things to rename. The library setting doesn't carry over.

## 0.2.1

- Chapters and replies are rendered by a vendored markdown-it 14.1.0, so nested lists, tables,
  and links containing parentheses display correctly.

## 0.2.0

- `/codie:open` picks up a commissioned book (a folder with `brief.md`) and plans it.
- The sidebar can be closed and resized, and threads collapse until opened.
- A message box on every page, with one conversation per chapter and one for the book, and
  `codie say` for the session to post unprompted.
- Tables in replies scroll instead of widening the sidebar.

## 0.1.0

- First release as a Claude Code plugin with its own marketplace: `/codie:new` (interview, or
  commission a book from another project), `/codie:open` for an existing book, and the reader,
  CLI and server.
