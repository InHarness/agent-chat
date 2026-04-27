# @inharness-ai/agent-chat

React chat UI kit for [@inharness-ai/agent-adapters](https://github.com/inharness/agent-adapters). Drop-in components and hooks for building AI agent conversations with streaming support.

Works with all agent architectures: Claude Code, Codex, OpenCode, Gemini.

## Features

- **Drop-in `<AgentChat />`** — full chat UI in one component
- **Individual hooks** — `useAgentChat()`, `useMessageReducer()`, `useEventStream()` for custom UI
- **Streaming** — real-time text deltas, thinking blocks, tool cards, subagent panels
- **Thread persistence** — JSON file-based conversation history with auto-save
- **Architecture/model selector** — switch between agents and models from the UI
- **Themeable** — CSS custom properties, override with plain CSS, light + dark themes
- **Node backend** — Express handlers that bridge HTTP/SSE to agent-adapters

## Quick Start

### 1. Install

```bash
npm install @inharness-ai/agent-chat @inharness-ai/agent-adapters react react-dom express
```

### 2. Server

```ts
// server.ts
import express from 'express';
import cors from 'cors';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

const handler = createChatHandler({
  architectures: {
    'claude-code': {
      models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
      default: 'claude-sonnet-4-20250514',
    },
    'codex': {
      models: ['o4-mini', 'o3'],
      default: 'o4-mini',
    },
    'gemini': {
      models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      default: 'gemini-2.5-pro',
    },
  },
  defaultArchitecture: 'claude-code',
  systemPrompt: 'You are a helpful assistant.',
  threadsDir: './threads',
});

const app = express();
app.use(cors());
app.use(express.json());

// Chat endpoints
app.post('/api/chat', handler.handleChat);
app.post('/api/chat/abort', handler.handleAbort);
app.get('/api/config', handler.handleConfig);

// Thread endpoints
app.get('/api/threads', handler.handleListThreads);
app.post('/api/threads', handler.handleCreateThread);
app.get('/api/threads/:id', handler.handleGetThread);
app.delete('/api/threads/:id', handler.handleDeleteThread);
app.patch('/api/threads/:id', handler.handleUpdateThread);

app.listen(3001, () => console.log('Server running on http://localhost:3001'));
```

### 3. Client — Drop-in

```tsx
import { AgentChat } from '@inharness-ai/agent-chat';
import '@inharness-ai/agent-chat/styles';

function App() {
  return (
    <AgentChat
      serverUrl="http://localhost:3001"
      theme="dark"
      showConfigBar={true}
      showThreadList={true}
      showUsage={true}
      batchTools={false}
    />
  );
}
```

#### `<AgentChat />` props

| Prop | Type | Default | Description |
|---|---|---|---|
| `serverUrl` | `string` | — | Base URL of the Express server running `createChatHandler`. |
| `theme` | `'light' \| 'dark'` | `'light'` | Sets `data-ac-theme` on the root element. |
| `onThemeChange` | `(theme) => void` | — | If provided, shows a theme toggle button in the UI. |
| `className` | `string` | — | CSS class forwarded to the root element. |
| `showConfigBar` | `boolean` | `true` | Render the architecture/model dropdowns and advanced-options drawer. |
| `showThreadList` | `boolean` | `true` | Render the thread sidebar. |
| `showUsage` | `boolean` | `false` | Render the `UsageDisplay` footer (tokens + context window). |
| `batchTools` | `boolean` | `false` | Collapse consecutive tool calls of the same category into a single `ToolBatchBlock`. |

### 3. Client — Custom UI with Hooks

```tsx
import { useAgentChat } from '@inharness-ai/agent-chat';
import '@inharness-ai/agent-chat/styles';

function MyChat() {
  const {
    // Conversation state
    messages,
    isStreaming,
    error,
    usage,
    sessionId,
    contextWindow,
    currentTodoItems,

    // Architecture & model
    config,
    configLoading,
    architecture,
    model,
    setArchitecture,
    setModel,

    // Advanced options (forwarded to the server on each turn)
    cwd, setCwd, activeCwd, defaultCwd,
    systemPrompt, setSystemPrompt,
    maxTurns, setMaxTurns,
    architectureConfig, setArchitectureConfig, architectureOptions,
    planMode, setPlanMode,

    // Threads
    threads,
    activeThreadId,
    createThread,
    loadThread,
    deleteThread,
    renameThread,

    // Actions
    sendMessage,
    abort,
  } = useAgentChat({ serverUrl: 'http://localhost:3001' });

  return (
    <div>
      {/* Build your own UI using the state and actions above */}
      <select value={architecture} onChange={e => setArchitecture(e.target.value)}>
        {config && Object.keys(config.architectures).map(a => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>

      {messages.map(msg => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong>
          {msg.blocks.map((block, i) => (
            block.type === 'text' && <p key={i}>{block.text}</p>
          ))}
        </div>
      ))}

      <input
        onKeyDown={e => e.key === 'Enter' && sendMessage(e.currentTarget.value)}
        disabled={isStreaming}
      />
      {isStreaming && <button onClick={abort}>Stop</button>}
    </div>
  );
}
```

## Components

All components use `data-ac` attributes for styling. You can use them individually:

| Component | Description |
|---|---|
| `<AgentChat />` | Full drop-in chat (composes everything below) |
| `<ChatContainer />` | Scrollable message area with auto-scroll |
| `<MessageList />` | Renders a list of `ChatMessage` objects |
| `<ChatMessage />` | Single message (user or assistant) |
| `<AssistantContent />` | Renders content blocks (text, tools, thinking, etc.) |
| `<UserContent />` | Renders user message |
| `<TextBlock />` | Markdown-rendered text with syntax highlighting |
| `<CodeBlock />` | Code block with language label and copy button |
| `<ThinkingBlock />` | Collapsible reasoning/thinking block |
| `<ToolUseBlock />` | Tool invocation card with collapsible input |
| `<ToolResultBlock />` | Tool result with collapsible output |
| `<ToolBatchBlock />` | Groups consecutive same-category tool calls into a summary block |
| `<TodoListBlock />` | Renders a todo-list content block from the agent |
| `<CurrentTodoList />` | Sticky header showing the thread's active todo list |
| `<ImageBlock />` | Base64 or URL image |
| `<SubagentPanel />` | Nested subagent container with progress |
| `<ConfigBar />` | Architecture and model dropdowns |
| `<AdvancedOptions />` | Drawer for `cwd`, `systemPrompt`, `maxTurns`, architecture-specific options, plan mode |
| `<ThreadList />` | Sidebar with conversation list |
| `<ThreadItem />` | Single thread entry with rename/delete |
| `<InputArea />` | Text input with send/abort buttons |
| `<ErrorDisplay />` | Error banner |
| `<LoadingIndicator />` | Animated loading dots |
| `<UsageDisplay />` | Token usage (input/output) |

## Hooks

| Hook | Description |
|---|---|
| `useAgentChat(config)` | Top-level hook — composes all others. Returns messages, config, threads, and actions. Forwards `endpoints` to `useEventStream` / `useThreads`. |
| `useMessageReducer(arch, model)` | Pure state machine for chat messages. Processes `WireEvent` stream into `ChatMessage[]`. |
| `useEventStream(options)` | Low-level SSE connection. Returns `{ startStream, joinStream, abort, disconnect }`. `abort()` stops the turn (closes the local stream **and** tells the server to abort via `POST /api/chat/abort`); `disconnect()` only closes the local stream so the server keeps streaming and persisting — reattach later with `joinStream(threadId)`. Endpoints configurable via `options.endpoints` (`StreamEndpoints`). |
| `useAgentConfig(serverUrl)` | Fetches `GET /api/config`, tracks current architecture and model. |
| `useThreads(options)` | CRUD operations on conversation threads. Endpoints configurable via `options.endpoints` (`ThreadsEndpoints`). |

## Theming

The default theme uses CSS custom properties. Override any `--ac-*` variable:

```css
/* Change accent color */
:root {
  --ac-accent: #2563eb;
  --ac-accent-hover: #1d4ed8;
}

/* Custom assistant message background */
[data-ac="message"][data-role="assistant"] {
  background: #f0f9ff;
}

/* Hide thinking blocks */
[data-ac="thinking"] {
  display: none;
}

/* Wider chat area */
:root {
  --ac-chat-max-width: 1200px;
}
```

Switch between light and dark themes:

```tsx
<AgentChat serverUrl="..." theme="dark" />
```

### Available CSS Variables

| Variable | Default (light) | Description |
|---|---|---|
| `--ac-chat-max-width` | `900px` | Max width of chat area |
| `--ac-chat-height` | `100vh` | Height of chat container |
| `--ac-sidebar-width` | `280px` | Thread list sidebar width |
| `--ac-bg-primary` | `#ffffff` | Main background |
| `--ac-bg-assistant` | `#f4f4f6` | Assistant message background |
| `--ac-bg-user` | `#e8e0ff` | User message background |
| `--ac-bg-tool` | `#f5f3ff` | Tool card background |
| `--ac-bg-thinking` | `#fffbeb` | Thinking block background |
| `--ac-bg-code` | `#1e1e2e` | Code block background |
| `--ac-accent` | `#7c3aed` | Primary accent color |
| `--ac-font-family` | `system-ui, ...` | Base font |
| `--ac-font-mono` | `SF Mono, ...` | Code font |
| `--ac-border-radius` | `8px` | Border radius |

See `variables.css` for the full list (50+ variables).

## Server API

### `createChatHandler(config)`

Creates an object with Express-compatible request handlers.

```ts
interface ChatHandlerConfig {
  architectures: Record<string, { models: string[]; default: string }>;
  defaultArchitecture: string;
  systemPrompt: string;
  maxConcurrentRequests?: number;  // default: 10
  threadsDir?: string;             // default: './threads'
  cwd?: string;                    // working directory for agents
  onEvent?: (event, requestId) => void;  // event hook for logging
}
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | Start a chat turn (returns SSE stream) |
| `POST` | `/api/chat/abort` | Abort an active stream by `requestId` |
| `GET` | `/api/chat/stream/:threadId` | Join an in-flight stream live (used after F5 / thread switch) |
| `GET` | `/api/config` | Available architectures and models |
| `GET` | `/api/threads` | List all threads (metadata only) |
| `POST` | `/api/threads` | Create a new thread |
| `GET` | `/api/threads/:id` | Get thread with full message history |
| `DELETE` | `/api/threads/:id` | Delete a thread |
| `PATCH` | `/api/threads/:id` | Rename a thread |

These paths are the defaults the client hooks call. They can be overridden per
client via `endpoints` (see [Custom endpoints](#custom-endpoints)) — the server
side is unchanged either way.

### Custom endpoints

Both `useEventStream` and `useThreads` accept an `endpoints` option to override
the default paths. Useful when your backend mounts the chat surface under a
different prefix, or your routing scheme doesn't match the canonical layout.
Omit `endpoints` to fall back to defaults — no breaking change for existing
consumers.

```ts
import { useEventStream, useThreads } from '@inharness-ai/agent-chat';

useEventStream({
  serverUrl: 'http://localhost:3001',
  onEvent, onError,
  endpoints: {
    chat: '/v2/chat/start',                                      // POST start
    abort: '/v2/chat/stop',                                      // POST { requestId }
    streamByThread: (id) => `/v2/chat/live/${encodeURIComponent(id)}`, // GET join
  },
});

useThreads({
  serverUrl: 'http://localhost:3001',
  onThreadLoaded,
  endpoints: {
    threads: '/v2/threads',
    threadById: (id) => `/v2/threads/${encodeURIComponent(id)}`,
  },
});
```

`useAgentChat` forwards an outer `endpoints` object to both:

```ts
useAgentChat({
  serverUrl: 'http://localhost:3001',
  endpoints: {
    stream: { chat: '/v2/chat/start', abort: '/v2/chat/stop' },
    threads: { threads: '/v2/threads' },
  },
});
```

### Chat Request Body

```json
{
  "prompt": "Hello",
  "threadId": "optional-thread-id",
  "architecture": "claude-code",
  "model": "claude-sonnet-4-20250514",
  "sessionId": "optional-session-id-for-resumption",
  "systemPrompt": "optional per-turn system prompt override",
  "maxTurns": 20,
  "allowedTools": ["Read", "Grep"],
  "architectureConfig": { "extra": "options" },
  "cwd": "/absolute/path/for/agent",
  "planMode": false
}
```

| Field | Required | Description |
|---|---|---|
| `prompt` | ✓ | User message text. |
| `threadId` | — | Omit to auto-create a new thread. |
| `architecture` | — | Overrides `defaultArchitecture` for this turn. |
| `model` | — | Overrides the architecture's default model. |
| `sessionId` | — | Resume an existing agent session (adapter-specific). |
| `systemPrompt` | — | Per-turn override of the handler's default system prompt. |
| `maxTurns` | — | Cap on agent turns for this request. |
| `allowedTools` | — | Allow-list of tool names the agent may call. |
| `architectureConfig` | — | Free-form options passed to the architecture adapter (mirrors `ArchOption` choices). |
| `cwd` | — | Working directory for the agent for this turn (falls back to handler default). |
| `planMode` | — | If `true`, runs the agent in read-only "plan mode". |

### SSE Events

The chat endpoint streams events in SSE format. Each event mirrors a [UnifiedEvent](https://github.com/inharness/agent-adapters#unifiedevent) from agent-adapters (the full union is `WireEvent` in `src/server/protocol.ts`):

```
event: connected
data: {"requestId":"...","threadId":"..."}

event: text_delta
data: {"type":"text_delta","text":"Hello","isSubagent":false}

event: thinking
data: {"type":"thinking","text":"...","isSubagent":false,"replace":false}

event: tool_use
data: {"type":"tool_use","toolName":"Read","toolUseId":"...","input":{...},"isSubagent":false}

event: tool_result
data: {"type":"tool_result","toolUseId":"...","summary":"...","isSubagent":false}

event: todo_list_updated
data: {"type":"todo_list_updated","items":[...],"source":"model-tool","isSubagent":false}

event: assistant_message
data: {"type":"assistant_message","message":{"role":"assistant","content":[...],"timestamp":"...","usage":{...}}}

event: subagent_started
data: {"type":"subagent_started","taskId":"...","description":"...","toolUseId":"..."}

event: subagent_progress
data: {"type":"subagent_progress","taskId":"...","description":"...","lastToolName":"Read"}

event: subagent_completed
data: {"type":"subagent_completed","taskId":"...","status":"success","summary":"..."}

event: result
data: {"type":"result","output":"...","usage":{"inputTokens":150,"outputTokens":42},"sessionId":"..."}

event: error
data: {"type":"error","error":"...","code":"..."}

event: flush
data: {"type":"flush"}

event: done
data: {}
```

Subagent-scoped events (`text_delta`, `thinking`, `tool_use`, `tool_result`, `todo_list_updated`) include a `subagentTaskId` when they belong to a specific subagent run, used for routing into the matching `<SubagentPanel />`.

## Development

### Prerequisites

- Node.js >= 18
- The [`@inharness-ai/agent-adapters`](https://github.com/inharness/agent-adapters) repo cloned as a sibling directory (`../agent-adapters`)

### Setup

```bash
npm install
```

### Build

```bash
npm run build        # one-off production build (tsup)
npm run dev          # rebuild on file changes (tsup --watch)
```

### Typecheck

```bash
npm run typecheck    # tsc --noEmit
```

### Tests

```bash
npm test             # vitest run (single run)
npx vitest           # vitest in watch mode
```

### Running the example app

The `examples/basic/` directory contains a working server + React UI:

```bash
cd examples/basic
npm install
npm run dev
```

This starts:
- **Backend** on `http://localhost:3001` (Express + `createChatHandler`)
- **UI** on `http://localhost:5173` (Vite + React)

Open **http://localhost:5173** in the browser to see the chat.

You can also run them separately:

```bash
npm run dev:server   # only the Express backend
npm run dev:client   # only the Vite frontend
```

### Project structure

```
src/
├── components/    # React UI components (<AgentChat />, <MessageList />, etc.)
├── hooks/         # React hooks (useAgentChat, useEventStream, etc.)
├── server/        # Express request handlers + session/thread management
├── styles/        # CSS (variables, component styles)
├── utils/         # Tool-batching + tool-category helpers
├── types.ts       # Shared TypeScript types
└── index.ts       # Client entry point
```

## License

MIT
