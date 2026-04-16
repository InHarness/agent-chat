# @inharness/agent-chat

React chat UI kit for [@inharness/agent-adapters](https://github.com/inharness/agent-adapters). Drop-in components and hooks for building AI agent conversations with streaming support.

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
npm install @inharness/agent-chat @inharness/agent-adapters react react-dom express
```

### 2. Server

```ts
// server.ts
import express from 'express';
import cors from 'cors';
import { createChatHandler } from '@inharness/agent-chat/server';

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
import { AgentChat } from '@inharness/agent-chat';
import '@inharness/agent-chat/styles';

function App() {
  return (
    <AgentChat
      serverUrl="http://localhost:3001"
      theme="dark"
      showConfigBar={true}
      showThreadList={true}
      showUsage={true}
    />
  );
}
```

### 3. Client — Custom UI with Hooks

```tsx
import { useAgentChat } from '@inharness/agent-chat';
import '@inharness/agent-chat/styles';

function MyChat() {
  const {
    messages,
    isStreaming,
    error,
    config,
    architecture,
    model,
    setArchitecture,
    setModel,
    threads,
    activeThreadId,
    createThread,
    loadThread,
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
| `<ImageBlock />` | Base64 or URL image |
| `<SubagentPanel />` | Nested subagent container with progress |
| `<ConfigBar />` | Architecture and model dropdowns |
| `<ThreadList />` | Sidebar with conversation list |
| `<ThreadItem />` | Single thread entry with rename/delete |
| `<InputArea />` | Text input with send/abort buttons |
| `<ErrorDisplay />` | Error banner |
| `<LoadingIndicator />` | Animated loading dots |
| `<UsageDisplay />` | Token usage (input/output) |

## Hooks

| Hook | Description |
|---|---|
| `useAgentChat(config)` | Top-level hook — composes all others. Returns messages, config, threads, and actions. |
| `useMessageReducer(arch, model)` | Pure state machine for chat messages. Processes `WireEvent` stream into `ChatMessage[]`. |
| `useEventStream(options)` | Low-level SSE connection. Parses `POST /api/chat` response into typed events. |
| `useAgentConfig(serverUrl)` | Fetches `GET /api/config`, tracks current architecture and model. |
| `useThreads(options)` | CRUD operations on conversation threads. |

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
| `POST` | `/api/chat/abort` | Abort an active stream |
| `GET` | `/api/config` | Available architectures and models |
| `GET` | `/api/threads` | List all threads (metadata only) |
| `POST` | `/api/threads` | Create a new thread |
| `GET` | `/api/threads/:id` | Get thread with full message history |
| `DELETE` | `/api/threads/:id` | Delete a thread |
| `PATCH` | `/api/threads/:id` | Rename a thread |

### Chat Request Body

```json
{
  "prompt": "Hello",
  "threadId": "optional-thread-id",
  "architecture": "claude-code",
  "model": "claude-sonnet-4-20250514",
  "sessionId": "optional-session-id-for-resumption"
}
```

If `threadId` is omitted, a new thread is created automatically.

### SSE Events

The chat endpoint streams events in SSE format. Each event mirrors a [UnifiedEvent](https://github.com/inharness/agent-adapters#unified-events) from agent-adapters:

```
event: connected
data: {"requestId":"...","threadId":"..."}

event: text_delta
data: {"type":"text_delta","text":"Hello","isSubagent":false}

event: tool_use
data: {"type":"tool_use","toolName":"Read","toolUseId":"...","input":{...},"isSubagent":false}

event: result
data: {"type":"result","output":"...","usage":{"inputTokens":150,"outputTokens":42},"sessionId":"..."}

event: done
data: {}
```

## Development

### Prerequisites

- Node.js >= 18
- The [`@inharness/agent-adapters`](https://github.com/inharness/agent-adapters) repo cloned as a sibling directory (`../agent-adapters`)

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
├── types.ts       # Shared TypeScript types
└── index.ts       # Client entry point
```

## License

MIT
