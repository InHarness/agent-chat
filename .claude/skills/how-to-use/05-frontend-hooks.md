<!-- anchor: a5hks001 -->
# Frontend — hooks mode

Use hooks when you want your own layout, your own input area, your own
data flow — but still want the streaming/state machine done for you.

The kit exposes a stack of hooks at three layers:

| Layer | Hook | What it owns |
|---|---|---|
| Top — composes the rest | `useAgentChat(config)` | Messages, threads, config, all actions. Forwards `endpoints`. |
| Mid | `useEventStream`, `useThreads`, `useAgentConfig` | Single concerns — stream, CRUD, config. |
| Low | `useMessageReducer` | Pure state machine: `WireEvent[] → ChatMessage[]`. |

Most apps want `useAgentChat`. Reach for the lower layers only when you
need to plug in non-default transports or maintain your own message store.

<!-- anchor: a5hks002 -->
## `useAgentChat` — quick recipe

```tsx
import { useAgentChat } from '@inharness-ai/agent-chat';
import '@inharness-ai/agent-chat/styles';

export function MyChat() {
  const {
    messages, isStreaming, error, usage, contextSize, sessionId, contextWindow,
    config, architecture, model, setArchitecture, setModel,
    threads, activeThreadId, createThread, loadThread, deleteThread, renameThread,
    sendMessage, abort,
  } = useAgentChat({ serverUrl: 'http://localhost:3001' });

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong>
          {msg.blocks.map((b, i) => b.type === 'text' && <p key={i}>{b.text}</p>)}
        </div>
      ))}
      <input
        disabled={isStreaming}
        onKeyDown={e => e.key === 'Enter' && sendMessage(e.currentTarget.value)}
      />
      {isStreaming && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```

Each `sendMessage` call posts a <inline_mention type="dto" slug="chat-request"/>
to `POST /api/chat` and routes the resulting <inline_mention type="dto" slug="wire-event"/>
stream into the message reducer.

<!-- anchor: a5hks003 -->
## What `useAgentChat` returns

- **Conversation state** — `messages`, `isStreaming`, `error`, `usage`,
  `contextSize`, `sessionId`, `contextWindow`, `currentTodoItems`.

`usage` and `contextSize` are **two distinct metrics** — picking the wrong one
gives nonsensical UI:

| Field | Type | Aggregation | Use for |
|---|---|---|---|
| `usage` | `UsageStats \| null` | **cumulative** — summed over every `result` frame of every turn | cost / billing alarms |
| `contextSize` | `number \| null` | **last `result` frame only** (overwritten) | "X / 200k" utilization bar |
| `contextWindow` | `number \| undefined` | per-model cap from server config | denominator for the bar |

`contextSize === lastResult.usage.inputTokens + lastResult.usage.outputTokens`
(cache fields are a subset of `inputTokens`, never add them on top). To render the bar:

```tsx
if (contextSize !== null && contextWindow) {
  const pct = Math.min(100, (contextSize / contextWindow) * 100);
  // <Bar value={pct} label={`${contextSize} / ${contextWindow}`} />
}
```

To show session billing instead, read `usage` — it is already the sum. Helper `contextSizeOf(usage)` is exported from the package root
for callers that only have a `UsageStats` (e.g. from a subagent block).
- **Architecture & model** — `config`, `configLoading`, `architecture`,
  `model`, `setArchitecture`, `setModel`.
- **Per-turn options** (forwarded into the next `ChatRequest`) —
  `cwd`/`setCwd`/`activeCwd`/`defaultCwd`, `systemPrompt`/`setSystemPrompt`,
  `maxTurns`/`setMaxTurns`, `architectureConfig`/`setArchitectureConfig`/
  `architectureOptions`, `planMode`/`setPlanMode`.
- **Threads** — `threads`, `activeThreadId`, `createThread`, `loadThread`,
  `deleteThread`, `renameThread`.
- **Actions** — `sendMessage(text)`, `abort()`, plus the MCP elicitation
  responder consumed internally by `<UserInputResponderProvider>`.

<!-- anchor: a5hks004 -->
## Custom endpoints

If the server-side paths differ from the defaults (for example you mounted
the chat surface under `/v2/`), pass an `endpoints` map. `useAgentChat`
forwards it to `useEventStream` and `useThreads`:

```ts
useAgentChat({
  serverUrl: 'http://localhost:3001',
  endpoints: {
    stream: {
      chat: '/v2/chat/start',
      abort: '/v2/chat/stop',
      streamByThread: id => `/v2/chat/live/${encodeURIComponent(id)}`,
    },
    threads: {
      threads: '/v2/threads',
      threadById: id => `/v2/threads/${encodeURIComponent(id)}`,
    },
  },
});
```

Omit `endpoints` to fall back to the defaults documented in `03-backend.md`.
This is purely client-side rerouting — the server contract is unchanged.

<!-- anchor: a5hks005 -->
## Abort vs disconnect

`useEventStream` exposes both:

- **`abort()`** — stops the local stream **and** tells the server to abort
  via `POST /api/chat/abort`. Use when the user clicks "Stop". The server
  stops generating and persists what it has so far.
- **`disconnect()`** — closes only the local stream. The server keeps
  generating and persisting. Reattach later with `joinStream(threadId)`,
  which calls `GET /api/chat/stream/:threadId`. Use this when the user
  navigates away or refreshes — they can rejoin the live turn on return.

`useAgentChat.abort` is the user-facing one. The disconnect/rejoin pair is
plumbed through automatically when the user switches threads or remounts.
You only need to call them yourself if you bypass `useAgentChat` and drive
`useEventStream` directly.

<!-- anchor: a5hks006 -->
## Going lower — `useMessageReducer`

Use this when you have your own SSE transport (different framing, a proxy,
WebSockets) and just want the state-machine. Feed it `WireEvent` objects
in order; it returns a `ChatMessage[]` you can render.

```ts
const reducer = useMessageReducer(architecture, model);
// reducer.handleWireEvent(event) for every parsed WireEvent in stream order
// reducer.state.messages is the ChatMessage[] you render
// Other helpers: sendUserMessage, restoreMessages, setArchitecture, setModel, clear
```

`reducer.state.messages` is the same shape `<MessageList />` consumes, so you
can mix: your own transport → `useMessageReducer` → bundled `<MessageList />`.

If you need the pure state machine without the React wrapper (custom store,
testing, server-side replay), import `messageReducer` and `createInitialState`
directly:

```ts
import { messageReducer, createInitialState } from '@inharness-ai/agent-chat';

const [state, dispatch] = useReducer(
  messageReducer,
  createInitialState(architecture, model),
);
dispatch({ type: 'EVENT', event });
```


<!-- anchor: p6vmu5cg -->
### What `result`, `turn_start`, `done` and `error` do to the state

`result` closes a block, a further `turn_start` closes a turn, `done` and `error` close
the stream (see <section_ref anchor="lqp1a6dx"/>).

| State | on `result` | on a further `turn_start` | on `done` / `error` |
|---|---|---|---|
| `messages` | the active message's open text/thinking blocks close; its `usage` grows by the block's | the active message is finalized; a new user/assistant pair is appended | the active message is finalized |
| `isStreaming` | untouched — stays `true` | untouched — stays `true` | `false` |
| `activeAssistantMessageId` | untouched | the new assistant message | `null` |
| `activeSubagents` | untouched — a running subagent is often why the session is held | cleared | cleared |
| `usage` | grows by the block's | untouched | untouched |
| `contextSize` | overwritten | untouched | untouched |
| `sessionId` | overwritten when present | untouched | untouched |

- **Frames arriving while `activeAssistantMessageId` is `null` are dropped.**
- **Teardown is idempotent.** `error` followed by `done` tears the stream down once.
- **Side-request errors do not end the stream.** `useAgentChat` dispatches
  `error` frames itself when an enqueue (`QUEUE_ERROR`) or a user-input answer
  (`USER_INPUT_ERROR`) fails. Those set `error` only; the live turn keeps
  streaming.
- **A replayed turn the thread already holds is ignored.** A `turn_start` whose
  `assistantMessageId` is already in `messages` (a reload restored it from disk,
  then a join replayed it) leaves no message active, so its frames are dropped
  rather than appended a second time.
- **A transport that dies without `done`.** When `useAgentChat`'s SSE connection
  closes cleanly without `done`, it tears itself down (a synthetic `done`). When
  the connection **drops** mid-stream (a network error), it rejoins
  `GET /api/chat/stream/:threadId` with `Last-Event-ID`, up to three times, so
  only the missed frames are replayed. If the stream already ended on the server
  (404), it delivers `done` and reloads the thread from disk. Only if it cannot
  rejoin does it surface a `NETWORK_ERROR`. `useEventStream` exposes the reload
  step as its `onStreamLost(threadId)` option. With your own transport, dispatch
  `{ type: 'EVENT', event: { type: 'done' } }` (or call
  `reducer.handleWireEvent({ type: 'done' })`) when it closes.

<!-- anchor: a5hks007 -->
## Composing bundled components

You can render any of the bundled components (`<MessageList />`,
`<AssistantContent />`, `<InputArea />`, `<ConfigBar />`,
`<ThreadList />`, `<UsageDisplay />`) and skip the `<AgentChat />`
wrapper. Two things `<AgentChat />` does that you need to do yourself:

1. Wrap the tree with `<ToolRendererProvider registry={toolRenderers}>`
   if you want anything other than `claudeCodeToolRenderers`. See
   `08-tool-renderers.md`.
2. Wrap with `<UserInputResponderProvider responder={chat.sendUserInputResponse}>`
   to enable MCP elicitation rendering inside `<UserInputRequestBlock />`.

`<MessageList />` does not accept a components map. To swap a specific
block type (say render `text` blocks differently), don't render
`<AssistantContent />` — render your own walker over `messages[].blocks`
and only call into `<TextBlock />` / `<ToolUseBlock />` / etc. where you
want them.


<section_ref anchor="a7adv001" relation="see_also"/>

<section_ref anchor="a8tlr001" relation="see_also"/>

<section_ref anchor="a3bck001" relation="depends_on"/>