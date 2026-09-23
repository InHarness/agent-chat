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
| `turn_start` | after `connected`, and again before each further turn on the same stream | `userMessageId`, `assistantMessageId`, echoed `prompt`, `timestamp`. |
| `text_delta` | streaming prose | `text` chunk, `isSubagent`, optional `subagentTaskId`. |
| `thinking` | reasoning trace | `text`, `replace?` (false = append, true = replace last). |
| `tool_use` | agent calls a tool | `toolName`, `toolUseId`, `input`. |
| `tool_result` | tool returned | `toolUseId`, `summary` (the truncated text). |
| `todo_list_updated` | agent's TODO snapshot changed | `items`, `source`. |
| `assistant_message` | end of an assistant message | full `WireNormalizedMessage` (used for persistence, mirrored to disk). |
| `subagent_started` / `_progress` / `_completed` | nested task lifecycle | `taskId`, status payloads. `subagent_completed.status` is `completed`, `failed`, `aborted` (closed because the whole run ended) or `stopped` (ended on its own while the run went on). |
| `user_input_request` | MCP elicitation | `request`. |
| `user_input_response` | client answered | `requestId`, `response`. |
| `result` | an assistant block closed — the adapter handed control back | `output` (the block's final text, as reported by the adapter), `usage` (billing — this block alone; sum them), `contextSize` (context-window occupancy after this block — overwrite, never sum), `sessionId?`. **A turn may carry several — see below.** |
| `error` | the turn failed — no further turn runs on this stream | `error` (string), `code` (one of the codes below). |
| `flush` | server flushed buffer | (no payload). |
| `done` | the stream is over | (no payload). Emitted by this server exactly once, as the stream's last frame, however the stream ends. The client closes the EventSource. |

Type guards (`isTextDeltaEvent`, `isResultEvent`, …) are exported from
`@inharness-ai/agent-chat/server` for narrowing on the receiving side.

<!-- anchor: rvzebgec -->
### Error codes

| `code` | Meaning |
|---|---|
| `ADAPTER_TIMEOUT` | The run outlived its `timeoutMs` backstop. |
| `IDLE_TIMEOUT` | `idleTimeoutMs` expired: the run went quiet while nothing was outstanding. |
| `TOOL_CALL_TIMEOUT` | One tool call did not return within `toolCallTimeoutMs`. |
| `SUBAGENT_TIMEOUT` | One subagent reported no progress within `subagentTimeoutMs`. |
| `BACKGROUND_HOLD_EXPIRED` | claude-code: after a `result`, while the adapter holds the session, no tracked background task reported within `claude_backgroundHoldCapMs` (default 90s) while work was still unsettled. Since agent-adapters 0.9.13 a background **subagent** outliving the turn does not keep the hold alive, however busy it is — raise the cap in `architectureConfig` (or set it to `null`) if yours do. |
| `TOOL_POLICY` | The requested tool gating cannot be enforced on this adapter. |
| `ABORTED` | Client posted to `/api/chat/abort` (or disconnected). |
| `INIT_ERROR` | Adapter failed to initialize (bad credentials, missing binary). |
| `ADAPTER_ERROR` | Generic adapter failure. |
| `UNKNOWN` | Anything else. |

The mapping lives in `errorToCode()` in `src/server/serialize.ts`.

<!-- anchor: lqp1a6dx -->
### Streams, turns and blocks

Three nested units, and a client must not confuse them:

- **Stream** — one `POST /api/chat` response, from `connected` to `done`.
- **Turn** — from a `turn_start` to the next `turn_start` or to `done`. A stream carries
  more than one when messages queued while a turn ran are sent to the agent after it.
- **Block** — closed by `result`. An adapter may hold the session open after handing
  control back — while subagents finish, or while background tasks it tracks are
  unsettled — then wake the model and emit another `result`. `claude-code` does exactly
  that; when such a hold runs out of time, the turn ends with `BACKGROUND_HOLD_EXPIRED`.

What that means for a client:

- **`result` may arrive several times in one turn.** Content frames after it —
  `text_delta`, `thinking`, `tool_use`, `tool_result`, `todo_list_updated`,
  `subagent_*`, `assistant_message` (one per SDK message) — belong to the same turn.
- **`turn_start` may arrive several times on one stream.** Each opens a new
  user/assistant pair; the previous pair is finished.
- **`done` ends the stream.** The server emits it exactly once, as the last frame.
  After an `error`, only `queue_cleared` (when messages were still queued — their
  texts go back to the composer), `queue_updated` and `done` follow.
- **Key "stream over" on `done`, never on `result`.** Treat the transport closing
  without `done` as `done`.
- **Counters differ.** `usage` on each `result` covers that block alone — add them up.
  `contextSize` is a snapshot — overwrite it; the last `result`'s value is current.

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
  │◄── result ───────────────────┤ block closed, session held │
  │◄── text_delta / subagent_* ──┼◄── model woken again ──────┤
  │◄── result ───────────────────┤ (repeats while held)       │
  │                              │ adapter stream ends        │
  │◄── done ─────────────────────┤                            │
  │                              │ appendMessages() writes    │
```

Persistence happens **once per stream, right after `done`** — every turn and block of
the stream is written in one go. Until then nothing from the stream is on disk: a
client that disconnects mid-stream should rejoin (see <section_ref anchor="1apm17vk"/>) rather than
reload the thread.

<!-- anchor: 1apm17vk -->
## Concurrency & rejoin

The session manager allows **one in-flight stream per thread**. A second
`POST /api/chat` against the same `threadId` while a turn is running
returns 409. The recommended client behavior is to use
`GET /api/chat/stream/:threadId` to rejoin the existing stream
instead — that endpoint replays the buffered frames since the turn
started, so a refreshed UI catches up without losing data.

The global cap (`maxConcurrentRequests`, default 10) is enforced
across all threads — excess requests get 429 immediately.

The replay follows the same rules as a live stream: it may hold several `turn_start`
and `result` frames, and the stream is over at `done`, which is always its last frame.

<!-- anchor: 3828uy9c -->
## Aborting

`POST /api/chat/abort` with a `{ requestId }` body cancels the matching
turn. The server emits an `error` event with `code: 'ABORTED'`,
followed by `done`. Whatever `assistantBlocks` had accumulated up to
that point are **still persisted** — partial assistant messages are a
normal state. Abort releases the thread at once — the next
`POST /api/chat` starts a new stream even while the aborted adapter is
still unwinding, and `POST /api/chat/queue/:threadId` stops accepting
messages. Frames the aborted stream still produces are discarded; they
never reach the thread's next stream, and no queued turn runs after
Stop.

<!-- anchor: rhvk15pd -->
## Migrating from the single-`result` contract

Clients written against an earlier reading of this page — where `result` meant "the
turn is over" — break on any adapter that holds the session: everything after the
first `result` is dropped, subagent panels close early, and a message sent at that
moment collides with the still-open stream (409 `STREAM_IN_PROGRESS`). No frame changed
shape; what changed is what the frames mean.

| If your code does | Do this instead |
|---|---|
| tears down state on `result` | tear down on `done` (and on `error`) |
| stops rendering deltas after `result` | keep rendering until `done` |
| closes subagent panels on `result` | close them on `done`, or on their own `subagent_completed` |
| reads `usage` from "the" `result` | sum `usage` over every `result` |
| reads `contextSize` from "the" `result` | keep the last `result`'s value |
| assumes one `turn_start` per stream | open a new pair on each `turn_start` |
| ignores `done` | `done` is the teardown signal; `useEventStream` now forwards it to `onEvent` |

`useAgentChat`, `useMessageReducer` and the server follow this contract from
agent-chat `0.4.0`.

<!-- anchor: 9eoxq2u2 -->
## Acceptance criteria — streams, turns and blocks

<tagged_list type="ac" tags="multi-result"/>
