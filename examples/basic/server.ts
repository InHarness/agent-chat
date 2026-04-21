import express from 'express';
import cors from 'cors';
import { createChatHandler } from '@inharness-ai/agent-chat/server';

const handler = createChatHandler({
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
