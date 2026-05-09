<!-- anchor: 5zqpvxms -->
# `createChatHandler` config — full reference

The factory in `@inharness-ai/agent-chat/server` returns a bag of
framework-agnostic handler functions. Everything the backend does is
parameterized through the single config object below.

```ts
interface ChatHandlerConfig {
  systemPrompt: string;
  architectures?: Record<string, { models: string[]; default: string }>;
  defaultArchitecture?: string;
  maxConcurrentRequests?: number;  // default: 10
  threadsDir?: string;             // default: './threads'
  cwd?: string;
  onEvent?: (event, requestId) => void;
  logger?: Logger;
}
```

<!-- anchor: q83h6mlx -->
## Required

<!-- anchor: p9j61g35 -->
### `systemPrompt: string`

Default system prompt for new threads. Per-thread overrides are
allowed via `StoredThread.systemPrompt` (set on
`POST /api/threads` or `PATCH /api/threads/:id`); the per-thread value
wins on every turn.

<!-- anchor: ml9gxets -->
## Architectures & models

<!-- anchor: 4o3nywto -->
### `architectures?: Record<string, { models: string[]; default: string }>`

Whitelist of agent architectures and their allowed models. The map
is also what `GET /api/config` returns — clients use it to render
`ConfigBar` choices. Each entry:

- `models` — model aliases the user is allowed to pick.
- `default` — preselected alias when a fresh thread is created.

If you omit `architectures`, the handler falls back to whatever
`@inharness-ai/agent-adapters` registered at runtime. **Provide it
explicitly to gate the choice surface** — the UI cannot show a model
the server didn't return.

`POST /api/chat` validates `(architecture, model)` against this map
on every request, not on thread creation. Renaming an alias here
disables it for already-existing threads at the next turn (they get a
400 with `validation-error`).

<!-- anchor: yviprm4b -->
### `defaultArchitecture?: string`

Preselected architecture for the `ConfigBar`. Must be a key in
`architectures`. If omitted, the first key wins.

<!-- anchor: 1njpvczj -->
## Operational

<!-- anchor: 2aodqyxv -->
### `maxConcurrentRequests?: number` (default `10`)

Cap on simultaneous in-flight `POST /api/chat` calls across the entire
process, enforced by the session manager. Excess requests get a 429
without ever touching the agent. Tune for your hosting tier — agents
are CPU-light but memory-heavy because of the buffered tool output.

<!-- anchor: qto175u8 -->
### `threadsDir?: string` (default `'./threads'`)

Directory the file-based `ThreadStore` writes into. `mkdir -p` runs at
construction. See `04-thread-files.md` for what gets written.

<!-- anchor: 0owvoktt -->
### `cwd?: string`

Working directory passed to spawned agents (claude-code, codex, gemini)
unless overridden per thread (`StoredThread.cwd`). When the agent is a
local CLI tool, this is the project root it operates on.

<!-- anchor: 7ip7nf79 -->
## Hooks

<!-- anchor: 016v7bvg -->
### `onEvent?: (event, requestId) => void`

Fired for **every** wire event the server emits, before serialization.
The `requestId` correlates frames within a single turn. Use it for:

- structured logging (one log line per event, traceable to the
  `connected` frame's `requestId`);
- billing metering (catch `result` events, sum `usage.inputTokens` /
  `usage.outputTokens` — cumulative across resumed turns);
- context-window metering (catch `result.contextSize` — post-turn
  utilization, take the LAST turn's value, never sum across turns —
  bounded by the model's window from `getModelContextWindow()`);
- redaction or audit (you see `text_delta`, `tool_use`, etc. live).

Do not block in this hook — it runs on the SSE write path. Anything
async should be queued.

<!-- anchor: llulok1i -->
### `logger?: Logger`

Sink for non-fatal errors the library would otherwise swallow:
corrupt thread files, malformed adapter events, background fetch
failures. Defaults to `console.warn` in development and silent in
production. The `Logger` shape is the same one you can pass on the
client (`AgentChatConfig.logger`).

<!-- anchor: 1dgcr3xz -->
## Per-thread overrides

Several fields under `ChatHandlerConfig` (or `ChatRequest`) have
per-thread equivalents stored on `StoredThread`:

| Handler default | Per-thread override |
|---|---|
| `systemPrompt` | `StoredThread.systemPrompt` |
| `cwd` | `StoredThread.cwd` |
| (none — request-only) | `StoredThread.maxTurns` |
| (none — request-only) | `StoredThread.architectureConfig` |
| (none — request-only) | `StoredThread.planMode` |

The override resolution order on each turn is:
**ChatRequest body → StoredThread field → ChatHandlerConfig default.**
First non-undefined wins.

<!-- anchor: ihetzsfi -->
## Returned handler shape

```ts
const handler = createChatHandler({ systemPrompt: '…' });

handler.handleChat            // POST /api/chat (SSE)
handler.handleAbort           // POST /api/chat/abort
handler.handleUserInput       // POST /api/chat/user-input
handler.handleStream          // GET  /api/chat/stream/:threadId  (rejoin)
handler.handleConfig          // GET  /api/config
handler.handleListThreads     // GET    /api/threads
handler.handleCreateThread    // POST   /api/threads
handler.handleGetThread       // GET    /api/threads/:id
handler.handleDeleteThread    // DELETE /api/threads/:id
handler.handleUpdateThread    // PATCH  /api/threads/:id
```

Each function is `(req, res) => void` for the Express reference. For
non-Express frameworks see `02-framework-mounting.md` — the
adapter is always shallow.
