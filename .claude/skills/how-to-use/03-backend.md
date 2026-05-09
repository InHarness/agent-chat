<!-- anchor: a3bck001 -->
# Backend setup

The backend is a thin Node layer that delegates to `createChatHandler`,
which owns session bookkeeping, thread persistence, and the SSE bridge to
agent-adapters. **Express is used here as the reference framework** — the
handler functions are framework-agnostic, so you can mount them on
NestJS, Fastify, Koa, Hono, plain `http`, or a meta-framework's route
handlers (Next.js, Remix) with the same wiring shape. Both the drop-in
component and the hooks talk to the same endpoints, so this page is
shared by every client mode.

<!-- anchor: a3bck002 -->
## Minimal server (Express reference)

> Other frameworks: see notes after the snippet — the handler functions
> are the same; only the routing call shape changes.

```ts
// server.ts
import express from 'express';
import cors from 'cors';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

const handler = createChatHandler({
  systemPrompt: 'You are a helpful assistant.',
  threadsDir: './threads',
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Chat
app.post('/api/chat',                       handler.handleChat);
app.post('/api/chat/abort',                 handler.handleAbort);
app.post('/api/chat/user-input',            handler.handleUserInput);
app.get ('/api/chat/stream/:threadId',      handler.handleStream);
app.get ('/api/config',                     handler.handleConfig);

// Threads
app.get   ('/api/threads',                  handler.handleListThreads);
app.post  ('/api/threads',                  handler.handleCreateThread);
app.get   ('/api/threads/:id',              handler.handleGetThread);
app.delete('/api/threads/:id',              handler.handleDeleteThread);
app.patch ('/api/threads/:id',              handler.handleUpdateThread);

app.listen(3001);
```

Mounting all eleven endpoints is required for the client kit to function
end-to-end — including MCP elicitation (`/api/chat/user-input`) and live
stream rejoin after an F5 (`/api/chat/stream/:threadId`). These two are
generic to every architecture; nothing about them is Claude-specific.

If your routing scheme differs, change the paths here and override them on
the client via the `endpoints` option (see `05-frontend-hooks.md`). Don't
strip endpoints — disable features instead.

<!-- anchor: a3bck003 -->
## `createChatHandler` config

```ts
interface ChatHandlerConfig {
  architectures?: Record<string, { models: string[]; default: string }>;
  defaultArchitecture?: string;
  systemPrompt: string;
  maxConcurrentRequests?: number;  // default: 10
  threadsDir?: string;             // default: './threads'
  cwd?: string;                    // working directory for agents
  onEvent?: (event, requestId) => void;  // event hook for logging
  logger?: Logger;                 // sink for non-fatal errors (corrupt thread files, etc.); defaults to console.warn in dev
}
```

Omitting `architectures` falls back to whatever is registered in
`@inharness-ai/agent-adapters` at runtime. Provide it explicitly to **gate**
the choice surface — the `ConfigBar` only shows what the server returns from
`GET /api/config`.

<single_element type="dto" slug="server-config"/>

<!-- anchor: a3bck004 -->
## The chat surface

The chat slice is everything tagged `chat-protocol` — the start/abort/join
endpoints and their wire DTOs:

<tagged_list_mixed tags="chat-protocol"/>

A turn flows like this:

1. Client `POST /api/chat` with a <inline_mention type="dto" slug="chat-request"/> body.
2. Server validates (max prompt length 100 000 chars, allowed architectures,
   typed fields), responds 400 with <inline_mention type="dto" slug="validation-error"/>
   on bad input, otherwise opens an SSE stream.
3. Server emits a stream of <inline_mention type="dto" slug="wire-event"/>
   frames terminated by `event: done`.
4. Each `assistant_message` event is also persisted to the thread JSON file.

<single_element type="endpoint" slug="post-api-chat"/>

<!-- anchor: a3bck005 -->
## Threads & MCP elicitation

Thread CRUD lives behind the endpoints tagged `thread-management`:

<tagged_list type="endpoint" tags="thread-management"/>

MCP elicitation (the agent prompting the user mid-turn) is handled by a
side channel: the server emits a `user_input_request`-shaped event and waits
for the client to `POST /api/chat/user-input`. See `07-advanced.md` for the
wire flow.

<!-- anchor: a3bck006 -->
## Persistence

Threads are JSON files under `threadsDir`. There is **no database** — the
DTOs documented here describe in-memory and on-the-wire shapes only.
`StoredThread` / `StoredMessage` / `StoredContentBlock` are what gets
written to disk; the wire variants (`Wire*`) are what the client sees.

For the full on-disk schema, write semantics (whole-file rewrite, no
atomic rename, no cross-process locking), graceful degradation on
corrupt files, and migration/backup guidance, see
[`03-backend/04-thread-files.md`](./03-backend/04-thread-files.md).

If you need a different storage backend (Postgres, Redis, S3), the surface
to replace is the thread store inside `createChatHandler`. That's
intentionally not pluggable today; copy the file-store implementation as a
starting point.

<!-- anchor: a3bck007 -->
## Detail pages

This page is the overview. Deeper references live in `03-backend/`:

| File | Topic |
|---|---|
| `03-backend/01-handler-config.md` | Full `createChatHandler` config reference — architectures, hooks, logger, per-thread overrides |
| `03-backend/02-framework-mounting.md` | Mounting recipes for Fastify, NestJS, Hono, plain `http`, Next.js |
| `03-backend/03-chat-protocol.md` | Turn lifecycle, validation, full SSE wire format (`WireEvent`), error codes, abort & rejoin |
| `03-backend/04-thread-files.md` | **On-disk thread JSON schema and store semantics** — `StoredThread` / `StoredMessage` / `StoredContentBlock`, write semantics, replacing the store |
| `03-backend/05-mcp-elicitation.md` | `user_input_request` flow and the `/api/chat/user-input` side channel |
