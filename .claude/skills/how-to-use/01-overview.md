<!-- anchor: a1ovw001 -->
# Overview

`@inharness-ai/agent-chat` is a React kit for building chat UIs on top of
[`@inharness-ai/agent-adapters`](https://github.com/inharness/agent-adapters).
It ships a server-side helper (`createChatHandler`) that bridges HTTP/SSE to
any registered adapter (Claude Code, Codex, OpenCode, Gemini), and a client
side that comes in **two integration modes** — pick one based on how much UI
control you need.

<!-- anchor: a1ovw002 -->
## When to use which mode

| You want… | Use |
|---|---|
| A working chat in a few lines, default look-and-feel, all features wired | **Drop-in** — `<AgentChat />` (see `04-frontend-drop-in.md`) |
| Your own components and layout but the streaming/state logic done for you | **Hooks** — `useAgentChat()` and friends (see `05-frontend-hooks.md`) |
| Full control over wire-event handling | The lowest-level hooks: `useEventStream`, `useMessageReducer` |

Both modes talk to the same backend. Server setup is shared and lives in
`03-backend.md`.

<!-- anchor: a1ovw003 -->
## Terminology

- **Architecture** — an adapter from `@inharness-ai/agent-adapters`
  (`claude-code`, `codex`, `gemini`, `opencode`). Selected per turn.
- **Model** — model id within an architecture (`claude-sonnet-4-20250514`,
  `o4-mini`, …).
- **Thread** — a persisted conversation. Stored as a JSON file under
  `threadsDir`; addressed by `threadId`.
- **Session** — adapter-internal continuation handle. Surfaced as `sessionId`
  in `result` events; pass back into the next `ChatRequest` to resume.
- **Subagent** — a nested agent run scoped under a parent turn (e.g.
  Claude Code's `Task` tool). Routed into its own `<SubagentPanel />` via
  `subagentTaskId`.
- **Plan mode** — read-only run; agent may not mutate the filesystem or shell
  state. Toggled per turn via `planMode: true`.

<!-- anchor: a1ovw004 -->
## What this guide covers

The remaining pages walk vertical slices in the order you'd implement them:

1. **Install & wire CSS** — `02-installation.md`
2. **Server** (shared by both modes) — `03-backend.md`
3. **Client, drop-in** — `04-frontend-drop-in.md`
4. **Client, hooks** — `05-frontend-hooks.md`
5. **Theming** (horizontal cut) — `06-theming.md`
6. **Advanced features** — `07-advanced.md`
7. **Tool renderers & custom blocks** — `08-tool-renderers.md`
