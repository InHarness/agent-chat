<!-- anchor: li6kpp8v -->
# Mounting on non-Express frameworks

`createChatHandler` returns plain `(req, res) => void` functions
shaped like Express handlers. Most Node frameworks accept that shape
directly or behind a one-line bridge. The key invariants you must
preserve in any framework:

- `handleChat` writes an SSE stream — disable response buffering and
  do not auto-`JSON.stringify` the body.
- `handleStream` does the same on rejoin.
- All other handlers respond with JSON.
- Routes are exact paths from `03-backend.md` (`/api/chat`, `/api/threads/:id`,
  …). If you change them, mirror the change on the client via
  `endpoints` in `AgentChatConfig`.
- Body parsing must accept up to ~2 MB JSON (image blocks).

<!-- anchor: 8c8w98mv -->
## Fastify

```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

const handler = createChatHandler({
  systemPrompt: 'You are a helpful assistant.',
  threadsDir: './threads',
});

const app = Fastify();
await app.register(cors);

// Bridge: hand Fastify's raw req/res to the Express-shaped handler.
const adapt = (fn: (req: any, res: any) => void) =>
  (req: any, reply: any) => {
    reply.hijack(); // disable Fastify's response serialization
    fn(req.raw, reply.raw);
  };

app.post('/api/chat',                       adapt(handler.handleChat));
app.post('/api/chat/abort',                 adapt(handler.handleAbort));
app.post('/api/chat/user-input',            adapt(handler.handleUserInput));
app.get ('/api/chat/stream/:threadId',      adapt(handler.handleStream));
app.get ('/api/config',                     adapt(handler.handleConfig));

app.get   ('/api/threads',                  adapt(handler.handleListThreads));
app.post  ('/api/threads',                  adapt(handler.handleCreateThread));
app.get   ('/api/threads/:id',              adapt(handler.handleGetThread));
app.delete('/api/threads/:id',              adapt(handler.handleDeleteThread));
app.patch ('/api/threads/:id',              adapt(handler.handleUpdateThread));

app.listen({ port: 3001 });
```

`reply.hijack()` is required — without it Fastify tries to serialize a
body for SSE responses and breaks the stream. The handlers read
`req.body` (Fastify pre-parses) and write directly to `res`.

<!-- anchor: ogspdkrx -->
## NestJS

Mount via a controller that delegates to the raw handler. NestJS gives
you the underlying Express `req`/`res` with `@Req()` / `@Res()`:

```ts
import { Controller, All, Req, Res, Param } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

const handler = createChatHandler({
  systemPrompt: 'You are a helpful assistant.',
  threadsDir: './threads',
});

@Controller('api')
export class ChatController {
  @All('chat')                     chat        (@Req() r: Request, @Res() s: Response) { handler.handleChat(r, s); }
  @All('chat/abort')               abort       (@Req() r: Request, @Res() s: Response) { handler.handleAbort(r, s); }
  @All('chat/user-input')          userInput   (@Req() r: Request, @Res() s: Response) { handler.handleUserInput(r, s); }
  @All('chat/stream/:threadId')    stream      (@Req() r: Request, @Res() s: Response) { handler.handleStream(r, s); }
  @All('config')                   config      (@Req() r: Request, @Res() s: Response) { handler.handleConfig(r, s); }

  @All('threads')                  threads     (@Req() r: Request, @Res() s: Response) {
    return r.method === 'POST' ? handler.handleCreateThread(r, s) : handler.handleListThreads(r, s);
  }
  @All('threads/:id')              thread      (@Req() r: Request, @Res() s: Response) {
    if (r.method === 'GET')    return handler.handleGetThread(r, s);
    if (r.method === 'DELETE') return handler.handleDeleteThread(r, s);
    if (r.method === 'PATCH')  return handler.handleUpdateThread(r, s);
    s.status(405).end();
  }
}
```

Disable Nest's body limits at module config so 2 MB requests fit:

```ts
NestFactory.create(AppModule, { bodyParser: true })
  .then(app => app.use(json({ limit: '2mb' })));
```

<!-- anchor: jjyhf7vc -->
## Hono

Hono uses a `Request`/`Response` (Web Fetch API) shape rather than
Node's `req`/`res`. The server handlers expect Node objects, so the
Fastify-style bridge is needed when running on Node — this snippet
assumes Hono on Node via `@hono/node-server`:

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

const handler = createChatHandler({
  systemPrompt: 'You are a helpful assistant.',
  threadsDir: './threads',
});

const adapt = (fn: any) => (c: any) =>
  new Promise<Response>((resolve) => {
    fn(c.env.incoming, c.env.outgoing);
    c.env.outgoing.on('finish', () => resolve(new Response(null)));
  });

const app = new Hono();
app.post('/api/chat',                  adapt(handler.handleChat));
// … same as Express, with `adapt(handler.handleX)` instead of bare reference

serve({ fetch: app.fetch, port: 3001 });
```

On Cloudflare Workers / Deno / Bun (without Node compatibility for
streams), the handlers do **not** run as-is — they assume Node
`http.ServerResponse`. Port the streaming write path before deploying
there.

<!-- anchor: eqhoeloj -->
## Next.js Route Handlers (App Router)

Route Handlers expose Web `Request`/`Response`, so SSE has to be
written through a `ReadableStream`. The shipped handlers are
Node-shaped, which means the path of least resistance is to host the
chat backend as a separate process and have Next.js call it. If you
must co-locate, use a custom Node server (`server.js` in Next) and
mount the handlers on Express alongside `next()` — same pattern as
the Express reference.

> If you successfully port any handler to a pure-Web-Fetch shape,
> consider upstreaming it. Until then, treat Node-runtime hosts as
> the supported set.

<!-- anchor: ied3p6cs -->
## Plain `http`

For the smallest possible footprint:

```ts
import { createServer } from 'http';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

const handler = createChatHandler({
  systemPrompt: 'You are a helpful assistant.',
  threadsDir: './threads',
});

createServer((req, res) => {
  // Body parsing is your job here — see Express's `express.json` or
  // any tiny equivalent. The handlers expect a parsed `req.body`.
  // Routing is your job too: switch on `req.method` + `req.url`.
}).listen(3001);
```

Acceptable for embedded use cases (a desktop app shelling out to a
local server). For anything user-facing, take Express, Fastify, or
the Nest module above as a baseline — you'll want CORS, body parsing,
and request logging eventually anyway.
