<!-- anchor: ymlnhf8g -->
# Chat protocol — turn lifecycle and SSE wire format

This page documents what flows over the wire when a user sends a
message. Every endpoint listed here is in the `chat-protocol` slice;
the persistence side-effects are in `04-thread-files.md`.

<!-- anchor: csiulecn -->
## Endpoints involved

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | Start a turn. Validates, opens an SSE stream. |
| `GET /api/chat/stream/:threadId` | Rejoin a turn already in progress (e.g. after F5). |
| `POST /api/chat/abort` | Cancel an in-flight turn. |
| `POST /api/chat/user-input` | Reply to an MCP elicitation prompt (`05-mcp-elicitation.md`). |

All four are mounted in the Express reference (`03-backend.md`). The
client kit hits all of them; do not strip any.

<!-- anchor: x3z73i4g -->
## Request shape — `ChatRequest`

```ts
interface ChatRequest {
  prompt: string;
  threadId?: string;
  architecture?: string;
  model?: string;
  systemPrompt?: string;
  sessionId?: string;
  maxTurns?: number;
  allowedTools?: string[];
  architectureConfig?: Record<string, unknown>;
  cwd?: string;
  planMode?: boolean;
}
```

Validation (server-side, before the agent is touched):

- `prompt` ≤ 100 000 characters.
- `architecture` (if present) must be a key in `ServerConfig.architectures`.
- `model` (if present) must be in that architecture's `models` list.
- Type-checks on every field.

Failures return **HTTP 400** with a `validation-error` JSON body. The
SSE stream is *not* opened — clients should branch on response status.

<!-- anchor: x6rzelev -->
## Resolution order on each turn

For each field that has a per-thread or per-config default, the
server resolves at request time:

```
ChatRequest body  →  StoredThread field  →  ChatHandlerConfig default
```

The first non-undefined wins. Practical implication: passing
`systemPrompt` on `POST /api/chat` does **not** mutate the thread —
it only affects this turn. Use `PATCH /api/threads/:id` for sticky
changes.

<!-- anchor: r8rcnzrv -->
## SSE frames — `WireEvent`

Once validation passes, the response becomes
`Content-Type: text/event-stream`. Each frame:

```
event: <type>
id: <monotonic int per stream, optional>
data: <JSON of WireEvent>

```

The `WireEvent` union (from `src/server/protocol.ts`):

| `type` | When | Carries |
|---|---|---|
| `connected` | first frame | `requestId` — correlates `onEvent` hook calls. |
| `turn_start` | after `connected` | `userMessageId`, `assistantMessageId`, echoed `prompt`, `timestamp`. |
| `text_delta` | streaming prose | `text` chunk, `isSubagent`, optional `subagentTaskId`. |
| `thinking` | reasoning trace | `text`, `replace?` (false = append, true = replace last). |
| `tool_use` | agent calls a tool | `toolName`, `toolUseId`, `input`. |
| `tool_result` | tool returned | `toolUseId`, `summary` (the truncated text). |
| `todo_list_updated` | agent's TODO snapshot changed | `items`, `source`. |
| `assistant_message` | end of an assistant message | full `WireNormalizedMessage` (used for persistence, mirrored to disk). |
| `subagent_started` / `_progress` / `_completed` | nested task lifecycle | `taskId`, status payloads. |
| `user_input_request` | MCP elicitation | `request`. |
| `user_input_response` | client answered | `requestId`, `response`. |
| `result` | turn finished cleanly | `output`, `usage` (billing — sum across turns), `contextSize` (context window — take last turn only), `sessionId?`. |
| `error` | turn failed | `error` (string), `code` (one of the codes below). |
| `flush` | server flushed buffer | (no payload). |
| `done` | stream terminator | (no payload). The client closes the EventSource. |

Type guards (`isTextDeltaEvent`, `isResultEvent`, …) are exported from
`@inharness-ai/agent-chat/server` for narrowing on the receiving side.

<!-- anchor: rvzebgec -->
### Error codes

| `code` | Meaning |
|---|---|
| `ADAPTER_TIMEOUT` | Adapter exceeded its own timeout. |
| `ABORTED` | Client posted to `/api/chat/abort` (or disconnected). |
| `INIT_ERROR` | Adapter failed to initialize (bad credentials, missing binary). |
| `ADAPTER_ERROR` | Generic adapter failure. |
| `UNKNOWN` | Anything else. |

The mapping lives in `errorToCode()` in `src/server/serialize.ts`.

<!-- anchor: aejhnzp2 -->
## What the server strips

Adapters emit richer events internally than what crosses the wire. The
serializer (`unifiedEventToWire()`) removes:

- `result.rawMessages` — full normalized message log; redundant
  because the per-frame events already cover it.
- `result.todoListSnapshot` — redundant; the client reducer
  reconstructs from `todo_list_updated`.
- `assistant_message.message.native` — adapter-specific raw SDK shape;
  not JSON-safe, not useful client-side.
- `user_input_request.request.native` — same reason.

If you write a custom client, do not assume any `native` field exists.

<!-- anchor: 6snkjg1x -->
## Turn lifecycle — happy path

```
client                        server                       agent
  │                              │                            │
  │ POST /api/chat               │                            │
  ├─────────────────────────────►│                            │
  │                              │ validate, allocate slot    │
  │                              │ (maxConcurrentRequests)    │
  │ 200 SSE                      │                            │
  │◄─── connected, turn_start ───┤                            │
  │                              │ spawn / resume adapter     │
  │                              ├──────────────────────────► │
  │◄── text_delta × N ───────────┼◄── deltas ────────────────┤
  │◄── tool_use / tool_result ───┼◄── tool calls ────────────┤
  │◄── assistant_message ────────┤                            │
  │                              │ persistTurn() rewrites file│
  │◄── result ───────────────────┤                            │
  │◄── done ─────────────────────┤                            │
```

Persistence happens **before** `result`/`done` — if your client
disconnects between `assistant_message` and `done`, the message is
already on disk.

<!-- anchor: 1apm17vk -->
## Concurrency & rejoin

The session manager allows **one in-flight turn per thread**. A second
`POST /api/chat` against the same `threadId` while a turn is running
returns 409. The recommended client behavior is to use
`GET /api/chat/stream/:threadId` to rejoin the existing stream
instead — that endpoint replays the buffered frames since the turn
started, so a refreshed UI catches up without losing data.

The global cap (`maxConcurrentRequests`, default 10) is enforced
across all threads — excess requests get 429 immediately.

<!-- anchor: 3828uy9c -->
## Aborting

`POST /api/chat/abort` with a `{ requestId }` body cancels the matching
turn. The server emits an `error` event with `code: 'ABORTED'`,
followed by `done`. Whatever `assistantBlocks` had accumulated up to
that point are **still persisted** — partial assistant messages are a
normal state.
