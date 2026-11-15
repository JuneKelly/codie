# zimone server API

The contract between the server (`runtime/lib/server.mjs`), the page (`runtime/shell/`) and the
CLI (`runtime/bin/zimone.mjs`). Changing anything here is a **minor** version bump (see the
`version-bump` skill): the page and the server must agree, and a user can end up with an old
server and an updated page.

The model is deliberately generic: workbooks, units, blocks, threads, messages, unit states and
two event types. Learning-specific ideas (checks, objectives, confidence) live in the content and
the reference docs. The one place the server knows a block type is `RESPONSE_FIELDS` in
`runtime/lib/render.mjs`. Keep it that way: prefer a new field or state over a new route, thread
kind or event type.

## Conventions

- The server listens on `127.0.0.1:<port>`; the port is in `<workbook>/.zimone/server.json`
  (`{ port, pid, started }`) while it runs.
- Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` (else 403).
- POSTs must be `Content-Type: application/json` with a JSON object body of at most 1 MiB (else
  415, 400 or 413). A POST with a foreign `Origin` header gets 403.
- Responses are JSON. Errors are `{ "error": "<message>" }` with status 400 (bad input), 403,
  404 (unknown unit, thread, event or route), 409 (event already handled, or an anchored block
  that no longer exists), 413, 415 or 500.
- Required string fields must be non-empty; the error names the field.

## Objects

**Workbook** (`GET /api/workbook`): `workbook.json` as loaded, with defaults filled in for
`terms`, and each unit given `exists` and `state`.

```jsonc
{
  "title": "How Git Actually Works",
  "subtitle": "…",                       // or null
  "terms": { "workbook": ["workbook", "workbooks"], "unit": ["unit", "units"] },
  "units": [{ "id": "01-snapshots", "title": "…", "exists": true, "state": "done" }]  // state: null if never set
}
```

**Thread:**

```jsonc
{
  "id": "t3",
  "unit": "01-snapshots",          // null: the workbook's thread
  "anchor": null,                  // null: about the whole unit (or workbook); else, below
  "created": "2026-11-15T16:00:00.000Z",
  "status": "answered",            // derived: "queued" | "delivered" | "answered"
  "messages": [
    { "role": "user", "text": "…", "at": "…" },
    { "role": "user", "text": "…", "fields": { "confidence": 2 }, "at": "…" },     // a response to a block
    { "role": "agent", "text": "…", "html": "…", "at": "…", "event_id": "e4" },     // html rendered by the server; event_id on replies
    { "role": "system", "notice": { "type": "unit_state", "state": "done", "next_unit": "02-branches" }, "at": "…" }
  ]
}
```

An **anchor** is `{ block, quote, prefix, suffix }`. With a `quote`, the thread is about a passage
in that block (`prefix`/`suffix` hold up to 40 characters around it, for re-anchoring). With
`quote: null`, it's about the whole block; for a block type in `RESPONSE_FIELDS` (today, `check`)
that is where the user's responses go, and every user message must carry the type's `fields`.

There is one unanchored thread per unit and one for the workbook, and one whole-block thread per
block. Each passage question starts a new thread. Thread and event ids share one counter.

`status` is `queued` if the thread has an unhandled event no watcher has claimed, `delivered` if
one has been claimed but not replied to or acked, otherwise `answered`.

## Page routes

| Route | Body or query | Returns |
|---|---|---|
| `GET /`, `GET /u/<unit-id>` | | The page (`index.html`) |
| `GET /shell/zimone.js`, `/shell/zimone.css` | | Page assets |
| `GET /api/workbook` | | The workbook, above |
| `GET /api/units/:id` | | `{ id, title, html, errors: [{line, message}], prev, next, state }`; `prev`/`next` are `{ id, title, exists }` or null. 404 if unlisted or not written |
| `GET /api/threads` | `?unit=<id>`, or `?unit=` (empty) for the workbook | `{ threads }` |
| `GET /api/threads/:id` | | One thread |
| `POST /api/messages` | `{ text, unit?, anchor?, fields? }`, or `{ thread_id, text, fields? }` to follow up | The thread it went to. Event `message` |
| `POST /api/units/:id/state` | `{ state }`, one of `UNIT_STATES` (today `["done"]`) | `{ ok, thread }`. Records the state, adds a notice to the unit's thread and raises `unit_state`, unless the same state's event for that unit is still unhandled (then `thread` is null) |
| `GET /api/stream` | | Server-sent events, below |

`POST /api/messages` without `thread_id` finds or creates the thread: no anchor means the unit's
thread (or the workbook's, with no unit); an anchor needs a unit and an existing block id; an
anchor with a quote always starts a new thread.

## Agent routes (used by the CLI)

| Route | Body | Returns | CLI |
|---|---|---|---|
| `POST /api/events/claim` | `{}` | `{ instance, events }`: every unhandled event; newly claimed ones become `delivered` | `zimone watch` |
| `POST /api/reply` | `{ event_id, text }` | `{ ok, thread_id }`. Adds an `agent` message to the event's thread and marks it handled. 409 if already handled | `zimone reply` |
| `POST /api/post` | `{ text, unit? }` | `{ ok, thread_id }`. Adds an `agent` message to the unit's (or workbook's) thread, no event involved | `zimone post` |
| `POST /api/ack` | `{ event_id }` | `{ ok }`. Marks handled without a reply | `zimone ack` |

`instance` is a random id for the server run. The watcher clears its record of printed events
when it changes, because a reset `state.json` reuses ids.

Each claim also counts as the agent being present: the server reports it online on a claim, and
offline five seconds after the last one.

## Events

`zimone watch` prints `ZIMONE_EVENT <json>` for each event it hasn't printed this run (and
`ZIMONE_ERROR <message>` before exiting after ten failed claims). Fields come in this order,
short ones first, because Monitor notifications truncate long lines. Every event also has
`"redelivered": true | false`.

| `type` | Fields |
|---|---|
| `message` | `id, type, thread_id, unit, block, block_type, block_attrs, turn, fields, text, quote` |
| `unit_state` | `id, type, thread_id, unit, state, next_unit, next_exists` |

For a `message`, `block`, `block_type` and `block_attrs` (the block's other attributes, such as
`objective`) describe the anchored block, or are null for an unanchored thread. `turn` counts the
user's messages in the thread. `fields` is null unless the message is a response to a block.

## Event stream

`GET /api/stream` sends `data: <json>` lines, plus `: ping` comments every 25 seconds. On connect
it sends the current `agent` message.

| `type` | Payload | Sent when |
|---|---|---|
| `thread` | `{ thread }` | A thread is created or changes (message, claim, reply, ack) |
| `unit` | `{ id }` | `units/<id>.md` changes on disk (debounced 150 ms) |
| `workbook` | `{}` | `workbook.json` changes, or a unit's state changes |
| `agent` | `{ online }` | A watcher starts or stops claiming |

## Stored state

`<workbook>/.zimone/state.json`, written atomically:
`{ version: 2, seq, threads: { <id>: thread }, events: [event], progress: { <unit>: { state, at } } }`.
Stored threads have no `status`, and agent messages no `html`. Stored events are
`{ id, type, thread_id, created, delivered_at, handled_at, payload }`, where `payload` is the
object the watcher prints. A file with another `version` is refused with an error; changing the
shape needs a new `STATE_VERSION` and a migration or a clear error.
