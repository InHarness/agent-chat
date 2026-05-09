<!-- anchor: a2ins001 -->
# Installation

The kit splits cleanly into two halves and you install them independently:

- **Frontend** — the React components and hooks. This is the *clue* of the
  library: streaming UI, message reducer, drop-in `<AgentChat />`,
  composable hooks. Most projects pull this in as-is.
- **Backend** — a thin handler factory (`createChatHandler`) that you mount
  on the Node HTTP framework of your choice. Express is the reference
  example throughout this guide, but the handler functions are framework-
  agnostic — drop them into NestJS, Fastify, Koa, Hono, plain `http`, or
  the route handlers of a meta-framework (Next.js, Remix). Most teams will
  end up writing their own server module.

Pick the install track you need; many apps install both, but a UI-only
package consuming an existing chat backend can stop after the frontend
half.

<!-- anchor: a2ins002 -->
## Frontend (the React kit)

```bash
npm install @inharness-ai/agent-chat react react-dom
```

Peer requirements:

| Package | Version | Why |
|---|---|---|
| `react`, `react-dom` | ≥ 18 | concurrent rendering, `useSyncExternalStore` |
| Modern bundler | — | ESM + CSS imports (Vite, Next.js, Remix, CRA, Webpack 5) |

The frontend has no runtime dependency on `@inharness-ai/agent-adapters`
or on Node — it talks to whatever HTTP/SSE backend implements the chat
protocol documented in `03-backend.md`. You can develop the UI against a
mocked endpoint or point it at a backend running in another repo.

<!-- anchor: a2ins003 -->
## Import the CSS

The kit ships a single stylesheet covering every component. Import it once
at the entry of your app (alongside React's mount):

```tsx
import '@inharness-ai/agent-chat/styles';
```

Without this import the components render unstyled. CSS is plain — no
CSS-in-JS — so it composes cleanly with Vite, CRA, Next.js, Remix, or any
bundler that handles CSS imports. For per-variable overrides see
`06-theming.md`.

<!-- anchor: a2ins004 -->
## Bundler notes

- **Vite**: works out of the box. The example app under `examples/basic/`
  uses Vite — copy its `vite.config.ts` if you want a known-good setup.
- **CRA / Webpack 4**: ensure your bundler can resolve the `./styles` export
  in `package.json` (modern subpath exports). Fall back to importing the
  raw file path if subpath exports aren't supported.
- **Next.js (app router)**: import the stylesheet from a client component
  or from `app/layout.tsx`. Keep `<AgentChat />` itself inside a
  `'use client'` boundary — it uses `useEffect`, `localStorage`, and SSE.
- **SSR**: the chat surface is client-only. There is nothing to render on
  the server; lazy-load it under a client boundary.

<!-- anchor: a2ins005 -->
## Backend (your choice of server)

The backend half is opt-in and minimal — `@inharness-ai/agent-chat/server`
exports `createChatHandler`, which returns plain request handlers. You
choose the HTTP framework and the deployment shape.

```bash
npm install @inharness-ai/agent-chat @inharness-ai/agent-adapters
<!-- anchor: 0dio9ap4 -->
# plus whatever server framework you use, e.g.:
npm install express cors
```

Server-side requirements:

| Requirement | Notes |
|---|---|
| Node | ≥ 18 (native `fetch`, web streams) |
| `@inharness-ai/agent-adapters` | matching major — registers architectures (Claude Code, Codex, Gemini, OpenCode) |
| HTTP framework | Express, NestJS, Fastify, Koa, Hono, Next.js route handlers, raw `http` — anything that can call a `(req, res)` function |
| API key env var | One of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, … per architecture you enable |

The `ConfigBar` lets the user pick any adapter the server advertises in
`GET /api/config`, so you can ship multi-adapter UIs as long as the
matching keys are present in the server environment.

The reference wiring with Express (eleven endpoints, all handlers from
the same factory) lives in `03-backend.md`. To use NestJS, Fastify, etc.,
mount the same handler functions on your framework's equivalent of
`app.post(path, handler)` — the handlers themselves don't know or care
which router invoked them.
