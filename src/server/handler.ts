import { resolve } from 'path';
import type { Request, Response } from 'express';
import type { RuntimeAdapter, UnifiedEvent } from '@inharness-ai/agent-adapters';
import { createAdapter, listArchitectures, getModelsForArchitecture, getArchitectureOptions, getModelContextWindow } from '@inharness-ai/agent-adapters';
import type {
  ArchitectureConfig,
  ServerConfig,
  StoredMessage,
  StoredContentBlock,
} from './protocol.js';
import { serializeSSE, unifiedEventToWire } from './serialize.js';
import { validateChatRequest } from './validate.js';
import { SessionManager } from './session-manager.js';
import { ThreadStore } from './thread-store.js';

export interface ChatHandlerConfig {
  architectures?: Record<string, ArchitectureConfig>;
  defaultArchitecture?: string;
  systemPrompt: string;
  maxConcurrentRequests?: number;
  threadsDir?: string;
  cwd?: string;
  onEvent?: (event: UnifiedEvent, requestId: string) => void;
}

export interface ChatHandler {
  handleChat: (req: Request, res: Response) => Promise<void>;
  handleAbort: (req: Request, res: Response) => void;
  handleConfig: (req: Request, res: Response) => void;
  handleListThreads: (req: Request, res: Response) => void;
  handleGetThread: (req: Request, res: Response) => void;
  handleCreateThread: (req: Request, res: Response) => void;
  handleDeleteThread: (req: Request, res: Response) => void;
  handleUpdateThread: (req: Request, res: Response) => void;
  destroy: () => void;
}

export function createChatHandler(config: ChatHandlerConfig): ChatHandler {
  const sessions = new SessionManager();
  const threads = new ThreadStore(config.threadsDir ?? './threads');
  const maxConcurrent = config.maxConcurrentRequests ?? 10;
  const architectures = config.architectures ?? buildDefaultArchitectures();
  const defaultArchitecture = config.defaultArchitecture ?? Object.keys(architectures)[0];
  const validArchitectures = Object.keys(architectures);

  const handleChat = async (req: Request, res: Response): Promise<void> => {
    // Validate
    const validation = validateChatRequest(req.body, validArchitectures);
    if (!validation.ok) {
      res.status(400).json({ errors: validation.errors });
      return;
    }

    // Check concurrency
    if (sessions.size >= maxConcurrent) {
      res.status(429).json({ error: 'Too many concurrent requests' });
      return;
    }

    const chatReq = validation.data;
    const architecture = chatReq.architecture ?? defaultArchitecture;
    const archConfig = architectures[architecture];
    const model = chatReq.model ?? archConfig.default;
    const requestId = crypto.randomUUID();

    // Auto-create thread if threadId not provided
    let threadId = chatReq.threadId;
    if (!threadId) {
      threadId = crypto.randomUUID();
      const title = chatReq.prompt.slice(0, 60).trim() + (chatReq.prompt.length > 60 ? '...' : '');
      threads.create(threadId, title, architecture, model, {
        cwd: chatReq.cwd ? resolve(chatReq.cwd) : undefined,
        systemPrompt: chatReq.systemPrompt,
        maxTurns: chatReq.maxTurns,
        architectureConfig: chatReq.architectureConfig,
        planMode: chatReq.planMode,
      });
    }

    // Create adapter
    let adapter: RuntimeAdapter;
    try {
      adapter = createAdapter(architecture);
    } catch (err) {
      res.status(500).json({ error: `Failed to create ${architecture} adapter: ${(err as Error).message}` });
      return;
    }

    sessions.register(requestId, adapter, architecture);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send connected event with requestId and threadId
    res.write(serializeSSE('connected', { requestId, threadId }));

    // Abort on client disconnect
    res.on('close', () => {
      sessions.abort(requestId);
    });

    // Collect messages for thread persistence
    const userMessage: StoredMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      blocks: [{ type: 'text', text: chatReq.prompt }],
      timestamp: new Date().toISOString(),
    };

    const assistantBlocks: StoredContentBlock[] = [];
    const subagentMessages = new Map<string, StoredMessage[]>();
    let resultSessionId: string | undefined;
    let resultUsage: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number } | undefined;

    // Look up existing session for resumption
    const existingThread = threads.get(threadId);
    const sessionId = chatReq.sessionId ?? existingThread?.sessionId;

    // Resolve per-request options with thread → request → server fallbacks
    const effectiveCwd = existingThread?.cwd ?? (chatReq.cwd ? resolve(chatReq.cwd) : undefined) ?? config.cwd ?? process.cwd();
    const effectiveSystemPrompt = chatReq.systemPrompt ?? existingThread?.systemPrompt ?? config.systemPrompt;
    const effectiveMaxTurns = chatReq.maxTurns ?? existingThread?.maxTurns;
    const effectiveArchitectureConfig: Record<string, unknown> | undefined =
      chatReq.architectureConfig ?? existingThread?.architectureConfig;
    const effectivePlanMode = chatReq.planMode ?? existingThread?.planMode;

    // Persist editable fields (systemPrompt, maxTurns, architectureConfig, planMode) for existing threads
    if (existingThread) {
      const updates: Record<string, unknown> = {};
      if (chatReq.systemPrompt !== undefined) updates.systemPrompt = chatReq.systemPrompt;
      if (chatReq.maxTurns !== undefined) updates.maxTurns = chatReq.maxTurns;
      if (chatReq.architectureConfig !== undefined) updates.architectureConfig = chatReq.architectureConfig;
      if (chatReq.planMode !== undefined) updates.planMode = chatReq.planMode;
      if (Object.keys(updates).length > 0) {
        threads.update(threadId, updates as { systemPrompt?: string; maxTurns?: number; architectureConfig?: Record<string, unknown>; planMode?: boolean });
      }
    }

    let eventId = 0;
    try {
      const stream = adapter.execute({
        prompt: chatReq.prompt,
        systemPrompt: effectiveSystemPrompt,
        model,
        resumeSessionId: sessionId,
        maxTurns: effectiveMaxTurns,
        allowedTools: chatReq.allowedTools,
        cwd: effectiveCwd,
        architectureConfig: effectiveArchitectureConfig,
        planMode: effectivePlanMode,
      });

      for await (const event of stream) {
        config.onEvent?.(event, requestId);

        const wireEvent = unifiedEventToWire(event as UnifiedEvent & Record<string, unknown>);
        res.write(serializeSSE(wireEvent.type, wireEvent, ++eventId));

        // Collect blocks for persistence
        collectBlock(event, assistantBlocks, subagentMessages);

        if (event.type === 'result') {
          const resultEvent = event as { sessionId?: string; usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number } };
          resultSessionId = resultEvent.sessionId;
          resultUsage = resultEvent.usage;
          sessions.setSessionId(requestId, resultSessionId!);
        }
      }
    } catch (err) {
      const wireError = {
        type: 'error' as const,
        error: (err as Error).message ?? String(err),
        code: 'UNKNOWN',
      };
      res.write(serializeSSE('error', wireError, ++eventId));
    } finally {
      res.write(serializeSSE('done', {}, ++eventId));
      res.end();
      sessions.remove(requestId);

      // Persist to thread
      const assistantMessage: StoredMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        blocks: assistantBlocks,
        timestamp: new Date().toISOString(),
        ...(resultUsage ? { usage: resultUsage } : {}),
      };
      threads.appendMessages(threadId!, [userMessage, assistantMessage], resultSessionId);
    }
  };

  const handleAbort = (req: Request, res: Response): void => {
    const { requestId } = req.body as { requestId?: string };
    if (!requestId || typeof requestId !== 'string') {
      res.status(400).json({ error: 'requestId is required' });
      return;
    }
    const aborted = sessions.abort(requestId);
    if (aborted) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'No active request with that ID' });
    }
  };

  const handleConfig = (_req: Request, res: Response): void => {
    const serverConfig: ServerConfig = {
      architectures: architectures,
      defaultArchitecture: defaultArchitecture,
      defaultCwd: config.cwd ?? process.cwd(),
    };
    res.json(serverConfig);
  };

  const handleListThreads = (_req: Request, res: Response): void => {
    res.json(threads.list());
  };

  const handleGetThread = (req: Request, res: Response): void => {
    const id = req.params.id as string;
    const thread = threads.get(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(thread);
  };

  const handleCreateThread = (req: Request, res: Response): void => {
    const { title, architecture, model, cwd, systemPrompt, maxTurns, architectureConfig, planMode } = req.body as {
      title?: string;
      architecture?: string;
      model?: string;
      cwd?: string;
      systemPrompt?: string;
      maxTurns?: number;
      architectureConfig?: Record<string, unknown>;
      planMode?: boolean;
    };

    const arch = architecture ?? defaultArchitecture;
    if (!validArchitectures.includes(arch)) {
      res.status(400).json({ error: `Invalid architecture: ${arch}` });
      return;
    }

    const archConfig = architectures[arch];
    const mdl = model ?? archConfig.default;
    const id = crypto.randomUUID();
    const thread = threads.create(id, title ?? 'New conversation', arch, mdl, {
      cwd: cwd ? resolve(cwd) : undefined,
      systemPrompt,
      maxTurns,
      architectureConfig,
      planMode,
    });

    res.status(201).json({
      id: thread.id,
      title: thread.title,
      architecture: thread.architecture,
      model: thread.model,
      cwd: thread.cwd,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    });
  };

  const handleDeleteThread = (req: Request, res: Response): void => {
    const deleted = threads.delete(req.params.id as string);
    if (deleted) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'Thread not found' });
    }
  };

  const handleUpdateThread = (req: Request, res: Response): void => {
    const { title } = req.body as { title?: string };
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const updated = threads.update(req.params.id as string, { title });
    if (!updated) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    res.json({
      id: updated.id,
      title: updated.title,
      architecture: updated.architecture,
      model: updated.model,
      cwd: updated.cwd,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  };

  const destroy = (): void => {
    sessions.destroy();
  };

  return {
    handleChat,
    handleAbort,
    handleConfig,
    handleListThreads,
    handleGetThread,
    handleCreateThread,
    handleDeleteThread,
    handleUpdateThread,
    destroy,
  };
}

// --- Default architecture config from @inharness-ai/agent-adapters ---

function buildDefaultArchitectures(): Record<string, ArchitectureConfig> {
  const result: Record<string, ArchitectureConfig> = {};
  for (const arch of listArchitectures()) {
    const models = getModelsForArchitecture(arch);
    if (models && models.length > 0) {
      const contextWindows: Record<string, number> = {};
      for (const m of models) {
        const window = getModelContextWindow(arch, m.alias);
        if (window !== undefined) contextWindows[m.alias] = window;
      }
      result[arch] = {
        models: models.map(m => m.alias),
        default: models[0].alias,
        options: getArchitectureOptions(arch),
        ...(Object.keys(contextWindows).length > 0 ? { contextWindows } : {}),
      };
    }
  }
  return result;
}

// --- Helpers for collecting blocks during streaming ---

function findActiveSubagentBlock(blocks: StoredContentBlock[]): (StoredContentBlock & { type: 'subagent' }) | undefined {
  // Find the most recently added running subagent block
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'subagent' && b.status === 'running') return b as StoredContentBlock & { type: 'subagent' };
  }
  return undefined;
}

function resolveSubagentBlock(
  blocks: StoredContentBlock[],
  subagentTaskId: string | undefined,
): (StoredContentBlock & { type: 'subagent' }) | undefined {
  if (subagentTaskId) {
    const byId = blocks.find(b => b.type === 'subagent' && b.taskId === subagentTaskId) as
      | (StoredContentBlock & { type: 'subagent' })
      | undefined;
    if (byId) return byId;
  }
  return findActiveSubagentBlock(blocks);
}

function appendToSubagentMessages(
  sub: StoredContentBlock & { type: 'subagent' },
  block: StoredContentBlock,
  upsertLastIfType?: StoredContentBlock['type'],
): void {
  const lastMsg = sub.messages[sub.messages.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    if (upsertLastIfType) {
      const lastBlock = lastMsg.blocks[lastMsg.blocks.length - 1];
      if (lastBlock && lastBlock.type === upsertLastIfType) {
        lastMsg.blocks[lastMsg.blocks.length - 1] = block;
        return;
      }
    }
    lastMsg.blocks.push(block);
  } else {
    sub.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      blocks: [block],
      timestamp: new Date().toISOString(),
      subagentTaskId: sub.taskId,
    });
  }
}

function collectBlock(
  event: UnifiedEvent,
  blocks: StoredContentBlock[],
  _subagentMessages: Map<string, StoredMessage[]>,
): void {
  switch (event.type) {
    case 'text_delta': {
      const e = event as { text: string; isSubagent: boolean; subagentTaskId?: string };
      if (e.isSubagent) {
        const sub = resolveSubagentBlock(blocks, e.subagentTaskId);
        if (!sub) return;
        const lastMsg = sub.messages[sub.messages.length - 1];
        const lastBlock = lastMsg?.blocks[lastMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += e.text;
        } else {
          appendToSubagentMessages(sub, { type: 'text', text: e.text });
        }
        return;
      }
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'text') {
        last.text += e.text;
      } else {
        blocks.push({ type: 'text', text: e.text });
      }
      break;
    }
    case 'thinking': {
      const e = event as { text: string; isSubagent: boolean; replace?: boolean; subagentTaskId?: string };
      if (e.isSubagent) {
        const sub = resolveSubagentBlock(blocks, e.subagentTaskId);
        if (!sub) return;
        const lastMsg = sub.messages[sub.messages.length - 1];
        const lastBlock = lastMsg?.blocks[lastMsg.blocks.length - 1];
        if (!e.replace && lastBlock && lastBlock.type === 'thinking') {
          lastBlock.text += e.text;
        } else {
          appendToSubagentMessages(sub, { type: 'thinking', text: e.text });
        }
        return;
      }
      const last = blocks[blocks.length - 1];
      if (!e.replace && last && last.type === 'thinking') {
        last.text += e.text;
      } else {
        blocks.push({ type: 'thinking', text: e.text });
      }
      break;
    }
    case 'tool_use': {
      const e = event as { toolName: string; toolUseId: string; input: unknown; isSubagent: boolean; subagentTaskId?: string };
      if (e.isSubagent) {
        const sub = resolveSubagentBlock(blocks, e.subagentTaskId);
        if (sub) appendToSubagentMessages(sub, { type: 'toolUse', toolUseId: e.toolUseId, toolName: e.toolName, input: e.input });
        return;
      }
      blocks.push({ type: 'toolUse', toolUseId: e.toolUseId, toolName: e.toolName, input: e.input });
      break;
    }
    case 'tool_result': {
      const e = event as unknown as { toolUseId: string; summary: string; isSubagent: boolean; subagentTaskId?: string };
      if (e.isSubagent) {
        const sub = resolveSubagentBlock(blocks, e.subagentTaskId);
        if (sub) appendToSubagentMessages(sub, { type: 'toolResult', toolUseId: e.toolUseId, content: e.summary });
        return;
      }
      blocks.push({ type: 'toolResult', toolUseId: e.toolUseId, content: e.summary });
      break;
    }
    case 'subagent_started': {
      const e = event as { taskId: string; description: string; toolUseId: string };
      blocks.push({ type: 'subagent', taskId: e.taskId, toolUseId: e.toolUseId ?? '', description: e.description, status: 'running', messages: [] });
      break;
    }
    case 'subagent_completed': {
      const e = event as { taskId: string; status: string; summary?: string; usage?: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number } };
      const sub = blocks.find(b => b.type === 'subagent' && b.taskId === e.taskId) as StoredContentBlock & { type: 'subagent' } | undefined;
      if (sub) {
        sub.status = e.status;
        sub.summary = e.summary;
        if (e.usage) sub.usage = e.usage;
      }
      break;
    }
    case 'todo_list_updated': {
      const e = event as { items: import('@inharness-ai/agent-adapters').TodoItem[]; isSubagent: boolean; subagentTaskId?: string };
      if (e.isSubagent) {
        const sub = resolveSubagentBlock(blocks, e.subagentTaskId);
        if (sub) appendToSubagentMessages(sub, { type: 'todoList', items: e.items }, 'todoList');
        return;
      }
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'todoList') {
        last.items = e.items;
      } else {
        blocks.push({ type: 'todoList', items: e.items });
      }
      break;
    }
  }
}
