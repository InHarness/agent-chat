import express from 'express';
import cors from 'cors';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

// Architecture-agnostic example server. The `ConfigBar` in the UI lets the
// user pick any adapter registered in `@inharness-ai/agent-adapters`
// (claude-code, gemini, codex, opencode, …). Set the matching env var for the
// adapter you want to use (ANTHROPIC_API_KEY, GEMINI_API_KEY, …).
//
// The handler wires every endpoint the paczka uses — including the routes
// added for MCP elicitation (`/api/chat/user-input`) and live stream rejoin
// after F5 (`/api/chat/stream/:threadId`). These are generic to every
// architecture; nothing below is Claude-specific.

const handler = createChatHandler({
  systemPrompt: 'You are a helpful assistant.',
  threadsDir: './threads',
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// The paths below are the defaults expected by the client hooks. If you mount
// the chat surface under a different prefix or routing scheme, override them
// per-hook via the `endpoints` option on `useEventStream` / `useThreads` (or
// `useAgentChat`'s `endpoints`). The server side is the same either way.

// --- Chat endpoints ---
app.post('/api/chat', handler.handleChat);
app.post('/api/chat/abort', handler.handleAbort);
app.post('/api/chat/user-input', handler.handleUserInput);
app.get('/api/chat/stream/:threadId', handler.handleStream);
app.get('/api/config', handler.handleConfig);

// --- Thread endpoints ---
app.get('/api/threads', handler.handleListThreads);
app.post('/api/threads', handler.handleCreateThread);
app.get('/api/threads/:id', handler.handleGetThread);
app.delete('/api/threads/:id', handler.handleDeleteThread);
app.patch('/api/threads/:id', handler.handleUpdateThread);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`agent-chat example server on http://localhost:${port}`);
});
