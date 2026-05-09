<!-- anchor: vkdxbtkk -->
# MCP elicitation — `user_input_request`

Some agents need to ask the user a question mid-turn (clarification,
confirmation, free-form input). The MCP spec calls this *elicitation*;
adapters surface it as a `user_input_request` event. This page is the
contract for both sides — server, and any client beyond the bundled
React kit.

<!-- anchor: h46zguq6 -->
## When it fires

The agent decides. Typical triggers:

- A tool registered with the agent declares "I need extra context";
  the agent pauses and elicits.
- A confirmation step ("are you sure you want to delete X?").
- A multi-choice prompt the model deliberately delegated to the user.

Elicitation is **per-turn, mid-stream** — the SSE stream stays open
while the server waits for the answer.

<!-- anchor: c5mc2qwp -->
## Wire frames

Two events bracket the exchange:

```
event: user_input_request
data: {
  "type": "user_input_request",
  "request": {
    "requestId": "…",
    "kind": "text" | "choice" | "confirm",
    "prompt": "…",
    "choices": [ … ]?,        // for kind=choice
    "default": "…"?,
    "metadata": { … }?        // adapter-specific, opaque
  }
}

event: user_input_response
data: {
  "type": "user_input_response",
  "requestId": "…",
  "response": { "value": "…" }   // shape depends on kind
}
```

The exact `UserInputRequest` / `UserInputResponse` shapes live in
`@inharness-ai/agent-adapters`; the chat package re-exports them via
`src/server/protocol.ts`. The serializer strips an internal `native`
field before the request crosses the wire — don't depend on it.

<!-- anchor: ckx50unc -->
## Side channel — `POST /api/chat/user-input`

The client does **not** answer over the SSE stream (SSE is one-way).
Instead, it posts to:

```
POST /api/chat/user-input
Content-Type: application/json

{
  "requestId": "<from user_input_request>",
  "response":  { "value": "…" }
}
```

The handler routes the response back into the running turn and emits
a `user_input_response` frame on the SSE stream so every observer
(including a rejoined client) sees the resolution.

<!-- anchor: 17s22wmb -->
## Lifecycle

```
client                       server                       agent
  │ (turn already streaming)    │                            │
  │                             │ ◄── elicitation request ──┤
  │ ◄── user_input_request ─────┤                            │
  │ (UI prompts user)           │ (waiting)                  │
  │                             │                            │
  │ POST /api/chat/user-input ─►│                            │
  │                             ├── deliver response ──────► │
  │ ◄── user_input_response ────┤                            │
  │ ◄── text_delta / tool_use ──┤◄── continues ──────────────┤
```

<!-- anchor: buw6jbja -->
## Persistence

A `userInputRequest` block lands on the assistant message (see
`04-thread-files.md`) regardless of whether the user ever answered.
The `response` field on that block is filled in as soon as
`POST /api/chat/user-input` arrives. If the user closes the tab
without answering and the turn aborts, the block stays on disk with
no `response` — the UI renders this as an unanswered prompt.

<!-- anchor: tix3ay6q -->
## Timeouts and abort

- The handler does **not** apply its own timeout to elicitation — the
  agent does. If the adapter has a timeout (e.g. claude-code sets one),
  exceeding it surfaces as a normal `error` frame with code
  `ADAPTER_TIMEOUT`.
- `POST /api/chat/abort` cancels an elicitation just like any other
  in-flight turn. The pending `userInputRequest` block is persisted
  without a `response`.
- Reconnecting via `GET /api/chat/stream/:threadId` while elicitation
  is pending replays the buffered `user_input_request` frame, so a
  refreshed UI re-prompts the user.

<!-- anchor: j5ixk0cu -->
## Implementing on a custom client

Minimum viable client logic:

1. Track a pending `requestId` whenever `user_input_request` arrives.
2. Render whatever UI matches `request.kind`.
3. On submit, `POST /api/chat/user-input` with `{ requestId, response }`.
4. Clear the pending state on `user_input_response` (don't rely on the
   POST's HTTP response — the SSE frame is the source of truth).

The bundled React kit does this inside the `useAgentChat` reducer; if
you bypass it, mirror the order of operations.
