# Message queueing + mid-turn injection (Etap 2)

Composer stays unlocked during a live turn; messages typed while the agent works
are queued and delivered **mid-turn** (push into the live Claude Agent SDK
session) or **after-turn** (merged into one follow-up turn). Implements decisions
D1–D4 from `PLAN-kolejkowanie.md`.

## What changed

- **Protocol** (`src/server/protocol.ts`): new `WireEvent`s `user_message`,
  `queue_updated`, `queue_cleared`; new `QueuedMessage` type; guards.
- **Reducer** (`src/hooks/eventHandlers/{userMessage,queueUpdated,queueCleared}.ts`,
  `messageReducer.ts`): mid-turn `user_message` finalizes the active assistant,
  appends the user message, and re-opens a fresh assistant; `queuedMessages`
  slice on `ChatState`; `RESTORE` hydrates the queue.
- **Client** (`useEventStream`, `useChatActions`, `useAgentChat`): queue endpoints
  + `queueMessage`/`cancelQueued`/`clearQueue`; `sendMessage` routes to the queue
  while streaming; `onQueueCleared` callback (D4); abort reads `clearedTexts`.
- **UI** (`InputArea.tsx`): unlocked textarea, separate Send (queue) + Stop
  buttons, queue chips, composer restore-on-clear.
- **Reference server** (`src/server/handler.ts`, `queue-store.ts`): in-memory
  `QueueStore`; `POST/DELETE /api/chat/queue/:threadId[...]`; mid-turn push +
  after-turn merged-dispatch turn loop; abort clears queue; `user_message`
  timestamp number→ISO mapping; `GET /api/threads/:id` hydrates `queuedMessages`.
- **Tests**: `queueReducer`, `serialize`, `queueStore`, `queueHandler`
  (integration: enqueue/cancel/clear, QUEUE_FULL, NO_ACTIVE_STREAM, after-turn
  merged dispatch, mid-turn push). Full suite green (143 tests).

## ⚠️ Before release

`package.json` currently points the adapter at the local worktree:

```json
"@inharness-ai/agent-adapters": "file:../agent-adapters-mid-turn-push"
```

agent-adapters **0.7.0** (which exports `pushMessage`, `streamingInput`,
`architectureCapabilities`, and the `user_message` UnifiedEvent) is committed on
its `feat/mid-turn-push` worktree but **not yet published to npm**. Once it is
published, swap the `file:` link back to a published range:

```json
"@inharness-ai/agent-adapters": "^0.7.0"
```

(The repo did the same dance before — see commit "Replace file: link to
agent-adapters with published ^0.4.0".)
