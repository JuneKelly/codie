# zimone server API

The contract between the server (`runtime/lib/server.mjs`), the reader page (`runtime/shell/`)
and the CLI (`runtime/bin/zimone.mjs`). Changing anything here is a **minor** version bump (see
the `version-bump` skill): the page and the server must agree, and a user can end up with an
old server and an updated page.

## Conventions

- The server listens on `127.0.0.1:<port>`; the port is in `<book>/.zimone/server.json`
  (`{ port, pid, started }`) while it runs.
- Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` (else 403).
- POSTs must be `Content-Type: application/json` with a JSON object body of at most 1 MiB (else
  415, 400 or 413). A POST with a foreign `Origin` header gets 403.
- Responses are JSON. Errors are `{ "error": "<message>" }` with status 400 (bad input), 403,
  404 (unknown chapter, thread, event or route), 409 (event already handled), 413, 415 or 500.
- Required string fields must be non-empty; the error names the field.

## Objects

**Thread**, as returned by the API:

```jsonc
{
  "id": "t3",
  "kind": "ask",                // "ask" | "check" | "conversation"
  "chapter": "01-snapshots",    // null for the book's conversation
  "block_id": "c1-p02",         // ask: anchored block or null (whole chapter); check: the check id; conversation: null
  "quote": "a SHA-1 hash",      // ask only: the selected text, or null
  "prefix": "…", "suffix": "…", // up to 40 chars around the quote, for re-anchoring
  "created": "2026-11-15T16:00:00.000Z",
  "status": "answered",         // derived: "queued" | "delivered" | "answered"
  "messages": [
    { "role": "reader", "text": "…", "at": "…" },                  // check answers add "confidence": 1-3
    { "role": "zimone", "text": "…", "html": "…", "at": "…", "event_id": "e4" }, // html rendered by the server; event_id only on replies
    { "role": "system", "text": "You marked this chapter finished. …", "at": "…" }
  ]
}
```

`status` is `queued` if the thread has an unhandled event that no watcher has claimed,
`delivered` if one has been claimed but not replied to or acked, otherwise `answered`.

There is at most one `conversation` thread per chapter and one for the book, and one `check`
thread per check. Thread and event ids share one counter.

## Reader routes (used by the page)

| Route | Body or query | Returns |
|---|---|---|
| `GET /`, `GET /c/<chapter-id>` | | The reader page (`index.html`) |
| `GET /shell/zimone.js`, `/shell/zimone.css` | | Page assets |
| `GET /api/book` | | `book.json` contents, with each chapter given `exists` and `finished` booleans |
| `GET /api/chapter/:id` | | `{ id, title, html, errors: [{line, message}], prev, next, finished }`; `prev`/`next` are `{ id, title, exists }` or null. 404 if unlisted or not written |
| `GET /api/threads` | `?chapter=<id>` or `?scope=book` | `{ threads }`: every thread for that chapter, or the book's conversation |
| `GET /api/thread/:id` | | One thread |
| `POST /api/ask` | `{ chapter, question, block_id?, quote?, prefix?, suffix? }` starts a thread; `{ thread_id, question }` follows one up | The thread. Event `ask` |
| `POST /api/message` | `{ text, chapter? }` (no chapter: the book's conversation) | The thread. Event `message` |
| `POST /api/answer` | `{ chapter, check_id, response, confidence: 1 \| 2 \| 3 }` | The check thread. Event `check_answer` |
| `POST /api/finished` | `{ chapter }` | `{ ok, thread }`. Marks the chapter finished, adds a system message to its conversation and raises `chapter_finished`, unless one is already unhandled for that chapter (then `thread` is null) |
| `GET /api/stream` | | Server-sent events, below |

## Session routes (used by the CLI)

| Route | Body | Returns | CLI |
|---|---|---|---|
| `POST /api/events/claim` | `{}` | `{ instance, events }`: every unhandled event; newly claimed ones become `delivered` | `zimone watch` |
| `POST /api/reply` | `{ event_id, text }` | `{ ok, thread_id }`. Adds a `zimone` message to the event's thread and marks it handled. 409 if already handled | `zimone reply` |
| `POST /api/say` | `{ text, chapter? }` | `{ ok, thread_id }`. Adds a `zimone` message to a conversation, no event involved | `zimone say` |
| `POST /api/ack` | `{ event_id }` | `{ ok }`. Marks handled without a reply | `zimone ack` |

`instance` is a random id for the server run. The watcher clears its record of printed events
when it changes, because a reset `state.json` reuses ids.

Each claim also counts as the session being present: the server reports the tutor as online on
a claim, and offline five seconds after the last one.

## Events

`zimone watch` prints `ZIMONE_EVENT <json>` for each event it hasn't printed this run (and
`ZIMONE_ERROR <message>` before exiting after ten failed claims). Fields come in this order,
short ones first, because Monitor notifications truncate long lines. Every event also has
`"redelivered": true | false`.

| `type` | Fields |
|---|---|
| `ask` | `id, type, thread_id, chapter, block_id, follow_up, question, quote` |
| `message` | `id, type, thread_id, scope ("chapter" \| "book"), chapter, text` |
| `check_answer` | `id, type, thread_id, chapter, check_id, objective, attempt, confidence, confidence_label, response` |
| `chapter_finished` | `id, type, thread_id, chapter, next_chapter, next_exists` |

## Event stream

`GET /api/stream` sends `data: <json>` lines, plus `: ping` comments every 25 seconds. On connect
it sends the current `tutor` message.

| `type` | Payload | Sent when |
|---|---|---|
| `thread` | `{ thread }` | A thread is created or changes (message, claim, reply, ack) |
| `chapter` | `{ id }` | `chapters/<id>.md` changes on disk (debounced 150 ms) |
| `book` | `{}` | `book.json` changes, or a chapter is marked finished |
| `tutor` | `{ online }` | A watcher starts or stops claiming |

## Stored state

`<book>/.zimone/state.json`, written atomically:
`{ version: 1, seq, threads: { <id>: thread }, events: [event], finished: { <chapter>: time } }`.
Stored threads have no `status` or `html`. Stored events are
`{ id, type, thread_id, created, delivered_at, handled_at, payload }`, where `payload` is the
object the watcher prints. Changing this shape needs a new `version` and a migration or a clear
error.
