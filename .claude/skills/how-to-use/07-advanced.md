<!-- anchor: a7adv001 -->
# Advanced

Features that don't fit the basic loop. Each section is independent —
read only what you need.

<!-- anchor: a7adv002 -->
## Subagents

When the agent spawns a nested run (e.g. Claude Code's `Task` tool), the
server emits a `subagent_started` event with a `taskId`, followed by
`subagent_progress` updates and a final `subagent_completed`. Any
`text_delta`, `thinking`, `tool_use`, `tool_result`, or
`todo_list_updated` event that belongs to that subagent carries
`subagentTaskId: "<taskId>"`.

The bundled `<SubagentPanel />` reads those events from the message
reducer and renders a collapsible nested container. In drop-in mode this
just works. In hooks mode, render the subagent blocks where they appear in
`messages[].blocks` — the reducer attaches them in order.

<!-- anchor: a7adv003 -->
## Plan mode

A read-only run. The agent receives the same tools but mutating ones are
blocked. Toggle per turn via `planMode: true` on the
<inline_mention type="dto" slug="chat-request"/>:

```ts
// Drop-in: there's a toggle in the AdvancedOptions drawer.
// Hooks:
const chat = useAgentChat({ serverUrl });
chat.setPlanMode(true);     // applies to subsequent sendMessage calls
chat.sendMessage('What changes would refactor X?');
```

Subagents inherit plan mode from the parent turn.

<!-- anchor: a7adv004 -->
## MCP elicitation

When the agent needs structured input from the user mid-turn (an MCP
elicitation), the server emits a `user_input_request` event carrying a
<inline_mention type="dto" slug="user-input-request"/>. The client
responds out-of-band by `POST /api/chat/user-input` with a
<inline_mention type="dto" slug="user-input-response"/>:

```
Server  ──► event: user_input_request   { requestId, schema, … }
Client  ──► POST /api/chat/user-input   { requestId, response }   (HTTP 200, no body)
Server  ──► (turn resumes, more wire events)
```

In drop-in mode `<UserInputRequestBlock />` renders the schema as a form
and posts the response automatically — `<UserInputResponderProvider>`
plugs in the chat's responder. In hooks mode you must wrap your tree with
the provider (`responder={chat.sendUserInputResponse}`); without it, the
form has nowhere to send.

<!-- anchor: a7adv005 -->
## Live stream rejoin

Streams keep running on the server even if the browser disconnects (F5,
thread switch, network blip). `<AgentChat />` and `useAgentChat` rejoin
automatically by calling
`GET /api/chat/stream/:threadId` whenever they detect a live turn for
the active thread. The first event the server emits on rejoin is a
`flush` of any buffered events since disconnect, then the stream
continues from there.

This is why `disconnect()` exists alongside `abort()`:

- `abort()` — stop generating server-side. Ends the turn.
- `disconnect()` — close only the local stream. Server keeps generating
  and persisting; you can rejoin later.

If you drive `useEventStream` directly (bypassing `useAgentChat`), call
`joinStream(threadId)` to rejoin instead of `startStream(...)`. They go
to different endpoints (`GET /api/chat/stream/:threadId` vs
`POST /api/chat`).

<!-- anchor: a7adv006 -->
## Architecture-specific options

`<inline_mention type="dto" slug="chat-request"/>` carries
`architectureConfig: Record<string, unknown>` — a free-form bag forwarded
to the adapter. The available keys per architecture come from
`architectureOptions` on `useAgentChat` (sourced from `GET /api/config`).

```ts
const chat = useAgentChat({ serverUrl });
chat.setArchitectureConfig({ thinkingBudget: 'medium' }); // claude-code example
```

Drop-in's `<AdvancedOptions />` renders a form for the current
architecture's options. In hooks mode you build your own from
`architectureOptions`.


<section_ref anchor="a5hks001" relation="see_also"/>

<section_ref anchor="a3bck001" relation="depends_on"/>