<!-- anchor: 3zza4wqy -->
# Thread file structure

Threads are persisted as one JSON file per thread under `threadsDir`
(default `./threads`). There is no database, no index file, no
migration system — the directory **is** the store. Listing threads is a
`readdir` + per-file `JSON.parse`. Reading one thread is a single file
read. Writing a turn is a single full-file rewrite (no append-log,
no journal).

This page documents what's actually written. The same shapes power the
`GET /api/threads/:id` response, so anything here is also what your UI
sees after a hard refresh.

> **Wire vs Stored.** Two parallel families exist:
> `Stored*` (on-disk, in `src/server/protocol.ts`) and `Wire*` (SSE
> frame payloads). They look similar but are not identical — the
> stored variants are **richer** (they carry `subagent`, `todoList`,
> `userInputRequest` blocks; wire frames carry incremental deltas
> instead). The reducer on the client folds wire events back into UI
> blocks that mirror the stored shape. See `03-chat-protocol.md` for the
> wire side.

(Cross-refs in this directory: `01-handler-config.md`, `02-framework-mounting.md`,
`03-chat-protocol.md`, `04-thread-files.md` (this page), `05-mcp-elicitation.md`.)

<!-- anchor: 1om1zbpv -->
## Filename convention

```
threadsDir/<threadId>.json
```

`threadId` is whatever the client (or `POST /api/threads`) chose, but
the store sanitizes it before touching the filesystem:

```ts
// src/server/thread-store.ts
const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
return join(this.dir, `${safe}.json`);
```

So `id` is restricted to `[A-Za-z0-9_-]` on disk regardless of what
came in. Path traversal (`../`, absolute paths) is not possible — the
characters are simply stripped. UUIDs and short slugs both work.

<!-- anchor: nzi5yz3o -->
## Top-level shape — `StoredThread`

```ts
interface StoredThread {
  id: string;                 // matches the filename
  title: string;              // human label, shown in thread list
  architecture: string;       // *current* arch — seeds next turn; mutable
                              // via PATCH. For "who authored this message"
                              // read StoredMessage.architecture instead.
  model: string;              // *current* model alias (same caveat).
  sessionId?: string;         // adapter session for multi-turn continuity
  cwd?: string;               // working directory passed to the agent
  systemPrompt?: string;      // per-thread override of handler default
  maxTurns?: number;          // adapter turn cap
  architectureConfig?: Record<string, unknown>;
                              // adapter-specific options (sandbox mode,
                              // approval mode, debug flags, …)
  planMode?: boolean;         // claude-code "plan mode" toggle
  createdAt: string;          // ISO 8601, set on create
  updatedAt: string;          // ISO 8601, refreshed on every write
  messages: StoredMessage[];  // append-only timeline
}
```

Optional fields are **omitted** rather than written as `null` — see how
`create()` and `update()` use spread-with-condition. Don't expect a
deterministic key order.

A real minimal example (a fresh thread, one turn, no tools):

```json
{
  "id": "15ced08d-1e5a-4a83-952c-7fd26c110183",
  "title": "jak sie masz?",
  "architecture": "codex",
  "model": "gpt-5.2-codex",
  "architectureConfig": {
    "debug": false,
    "codex_sandboxMode": "workspace-write"
  },
  "createdAt": "2026-04-28T20:36:52.379Z",
  "updatedAt": "2026-04-28T20:36:56.270Z",
  "messages": [
    { "id": "9437…", "role": "user",      "blocks": [ { "type": "text", "text": "jak sie masz?" } ], "timestamp": "…" },
    { "id": "12f7…", "role": "assistant", "blocks": [],                                                "timestamp": "…" }
  ]
}
```

<!-- anchor: 4vgeifjh -->
## Field semantics

| Field | When set | Mutable? | Notes |
|---|---|---|---|
| `id` | `create()` | no | Matches sanitized filename. |
| `title` | `create()` | yes (`PATCH /api/threads/:id`) | Free text; up to the UI. |
| `architecture` | `create()` | yes via `update()` | Must be a key in `ServerConfig.architectures`. **Thread-level = *current* setting**, not authorship. See `StoredMessage.architecture` for per-message attribution. |
| `model` | `create()` | yes via `update()` | Validated against the architecture's `models` list at request time, not at write time. Same authorship caveat as `architecture`. |
| `sessionId` | first `result` event of a turn | overwritten each turn | Adapter-owned token. Carried back into the next prompt to keep the agent's session warm. |
| `cwd` | `create()` | only via full `update()` | Passed straight to the agent process. |
| `systemPrompt` / `maxTurns` / `architectureConfig` / `planMode` | `create()` (optional) | yes | Per-thread overrides of `ChatHandlerConfig` defaults. |
| `createdAt` | `create()` | no | |
| `updatedAt` | every write | yes | Refreshed by `appendMessages` and `update`. Used as the sort key in the thread list (DESC). |
| `messages` | each turn | append-only in practice | The store also exposes a generic `update()` that *can* replace `messages` wholesale; chat turns always go through `appendMessages()`, which only concatenates. |

<!-- anchor: 61kfksfy -->
## Message — `StoredMessage`

```ts
interface StoredMessage {
  id: string;                       // unique within the thread
  role: 'user' | 'assistant';
  blocks: StoredContentBlock[];
  timestamp: string;                // ISO 8601
  subagentTaskId?: string;          // set when this message was
                                    // produced inside a subagent
  usage?: WireUsageStats;           // billing tokens for this assistant turn
  contextSize?: number;             // post-turn context window utilization
                                    //   (= usage.inputTokens + outputTokens).
                                    //   Optional — older threads written before
                                    //   this field exists read back as undefined;
                                    //   `storedMessageToChat` falls back to
                                    //   computing it from `usage`.
  architecture?: string;            // arch this message was authored under
  model?: string;                   // model alias this message was authored under
}
```

A turn writes **two** messages atomically (one rewrite of the file): the
user message and the assistant message. The user message is what the
client `POST`ed; the assistant message is built up from the stream and
flushed at the end via `persistTurn()` (see `src/server/persistence.ts`).

<!-- anchor: jq9t3ss2 -->
### `architecture` / `model` per message — audit trail

`StoredThread.architecture` and `StoredThread.model` are the thread's
**current** settings — mutable via `PATCH /api/threads/:id` and used to
seed the next turn. They are *not* a faithful record of which model
authored a given historical message: switching architectures mid-thread
would otherwise rewrite history.

To preserve that history, `persistTurn()` stamps the architecture and
model that *this turn* actually used onto **both** the user and the
assistant message:

```ts
// src/server/persistence.ts
const stampedUser: StoredMessage      = { ...userMessage, architecture, model };
const assistantMessage: StoredMessage = { id, role, blocks, timestamp, architecture, model, … };
```

Implications:

- **Always read these from the message, not the thread, when rendering
  per-message attribution** ("this answer was produced by codex / gpt-5.2").
  Reading from `StoredThread` shows you the *latest* setting, which is
  wrong after any rollover.
- **Back-compat — both fields are optional.** Threads written before
  these fields existed have messages with `architecture` / `model`
  undefined. Treat undefined as *"unknown — fall back to the thread's
  current `architecture` / `model` at load time"* rather than rejecting
  the message. Don't migrate old files just to fill these in; the
  thread-level fields are a fine fallback.
- The user message is stamped at persist time too (not at submit time),
  so user and assistant on a turn always agree on architecture/model
  even though the user prompt was sent before the agent started.
- Subagent-nested messages (inside a `subagent` block) inherit from
  the same turn, so they get stamped identically.

`usage` follows the wire shape:

```ts
interface WireUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}
```

<!-- anchor: wldt1n4u -->
## Content blocks — `StoredContentBlock`

A discriminated union with eight variants. The variant tag is the
literal `type` field.

```ts
type StoredContentBlock =
  | { type: 'text';      text: string }
  | { type: 'thinking';  text: string }
  | { type: 'toolUse';   toolUseId: string; toolName: string; input: unknown }
  | { type: 'toolResult';toolUseId: string; content: string; isError?: boolean }
  | { type: 'image';     source:
        | { type: 'base64'; mediaType: string; data: string }
        | { type: 'url';    url: string } }
  | { type: 'subagent';  taskId: string; toolUseId: string;
                         description: string; status: string;
                         summary?: string;
                         messages: StoredMessage[];   // recursive!
                         usage?: WireUsageStats }
  | { type: 'todoList';  items: TodoItem[] }
  | { type: 'userInputRequest';
                         requestId: string;
                         request: UserInputRequest;
                         response?: UserInputResponse };
```

<!-- anchor: pqqfyyku -->
### Per-variant notes

- **`text`** — assistant prose. Streaming deltas (`text_delta` wire
  events) are concatenated into a single `text` block before persisting.
- **`thinking`** — reasoning trace. Stored verbatim. Multiple `thinking`
  blocks in one message are normal (each "thought" gets its own block).
- **`toolUse` / `toolResult`** — paired by `toolUseId`. The store does
  not enforce pairing — a `toolUse` with no result is legal (e.g. the
  turn was aborted mid-call).
  - `input` is whatever the agent sent — schema is per-tool, not
    enforced here.
  - `content` for `toolResult` is the **summary** string the adapter
    produced, not the full tool output. Adapters truncate; the store
    does not.
- **`image`** — two source shapes: inline base64 (with `mediaType`) or
  remote `url`. The store writes whatever the adapter emitted; it does
  not download or recompress.
- **`subagent`** — the agent spawned a sub-task (e.g. claude-code's
  `Task` tool). It contains its own nested `messages: StoredMessage[]`,
  so threads can be **arbitrarily deep**. `status` mirrors the
  adapter's lifecycle (`running`, `completed`, `failed`); `summary` is
  the final return value if the subagent finished cleanly.
- **`todoList`** — snapshot of the agent's TODO list at the moment this
  block was emitted. Multiple `todoList` blocks in one message means
  the list changed mid-turn. Item shape (`TodoItem`) is owned by
  `@inharness-ai/agent-adapters`.
- **`userInputRequest`** — MCP elicitation. The `request` is the
  question the agent asked; `response` is the user's answer once it
  arrives via `POST /api/chat/user-input`. Until the user answers,
  `response` is absent — that's a normal partial state.

<!-- anchor: tiq6jfy0 -->
### What's stored that the wire doesn't carry directly

| Stored block | Wire equivalent |
|---|---|
| `subagent` | Reconstructed client-side from `subagent_started` / `subagent_progress` / `subagent_completed` + nested message events. |
| `todoList` | Reconstructed from `todo_list_updated` events. |
| `userInputRequest` | Reconstructed from `user_input_request` + `user_input_response` events. |

The server keeps these as first-class blocks so a fresh `GET /api/threads/:id` after F5 yields the same rendered transcript without replaying the stream.

<!-- anchor: jlij3jke -->
## Write semantics

All writes are **whole-file rewrites** via `writeFileSync`. Implications:

- **No partial writes / no journal.** A crash during `writeFileSync` can
  truncate the file. The store catches `JSON.parse` errors on read and
  logs through the configured `logger` (`logger.warn`, default
  `console.warn` in dev), then returns `null` for that thread —
  corrupt files are skipped from `list()` rather than thrown.
- **Pretty-printed.** `JSON.stringify(thread, null, 2)`. Files are
  diff-friendly; you can hand-edit them in a pinch.
- **No locking.** Two concurrent writes to the same thread can clobber
  each other. The session manager (one-flight per thread) is the only
  thing preventing this in practice — see `03-chat-protocol.md`.
- **`updatedAt` always refreshed** on `appendMessages` and `update`,
  even when the payload is empty. This is what powers thread-list sort.

<!-- anchor: 6w4g8mz2 -->
## Surface map

| Operation | Code | Effect on disk |
|---|---|---|
| `POST /api/threads` | `ThreadStore.create()` | Writes a new file; `messages: []`. |
| `GET /api/threads` | `ThreadStore.list()` | `readdir`, parse each file, return `ThreadMeta[]` (subset: id, title, arch, model, cwd, timestamps). Body is **never** returned here. |
| `GET /api/threads/:id` | `ThreadStore.get()` | Full file or `null`. |
| `PATCH /api/threads/:id` | `ThreadStore.update()` | Rewrites; bumps `updatedAt`. |
| `DELETE /api/threads/:id` | `ThreadStore.delete()` | `unlinkSync`. No tombstone. |
| `POST /api/chat` (end of turn) | `persistTurn()` → `appendMessages()` | Appends user + assistant `StoredMessage`. |

<!-- anchor: wxax83jw -->
## Replacing the store

The store is **not pluggable today**. If you need Postgres, Redis, S3,
or anything else, the surface to copy is `ThreadStore` in
`src/server/thread-store.ts` — six methods, no inheritance, no
abstract base class. Reimplement them, then swap the construction
inside `createChatHandler`. A future version may make this an injected
dependency; until then, expect to fork.

Things to watch for in any replacement:

- Preserve the `ThreadMeta` projection in `list()` — the UI never asks
  for full message history when rendering the sidebar.
- Keep `appendMessages()` truly append-only; the chat handler relies on
  this.
- `update()` is the only method that may rewrite `messages` wholesale
  (used by tooling, not by the chat path).
- Sanitize keys/ids so a malicious `threadId` cannot escape your
  storage namespace — the file store does this with a regex; an SQL
  store gets it via parameterized queries.

<todo comment="Once the store becomes a documented extension point, link to a recipe page here." />
