import { resolve } from 'path';
import type { Request, Response } from 'express';
import type { RuntimeAdapter, UnifiedEvent, UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';
import { createAdapter, listArchitectures, getModelsForArchitecture, getArchitectureOptions, getModelContextWindow } from '@inharness-ai/agent-adapters';
import type {
  ArchitectureConfig,
  ServerConfig,
  StoredMessage,
  StoredContentBlock,
  WireUsageStats,
} from './protocol.js';
import { serializeSSE, unifiedEventToWire } from './serialize.js';
import { validateChatRequest } from './validate.js';
import { SessionManager } from './session-manager.js';
import { ThreadStore } from './thread-store.js';
import { persistTurn } from './persistence.js';
import { applyEventToStoredBlocks } from './blockReducer.js';
import { resolveExecutionPlan, isResumeFailureError, buildReplayPromptForFallback } from './executionPlan.js';
import { defaultLogger, type Logger } from '../utils/logger.js';

export interface ChatHandlerConfig {
  architectures?: Record<string, ArchitectureConfig>;
  defaultArchitecture?: string;
  systemPrompt: string;
  maxConcurrentRequests?: number;
  threadsDir?: string;
  cwd?: string;
  onEvent?: (event: UnifiedEvent, requestId: string) => void;
  /**
   * Optional sink for non-fatal errors (corrupt thread files, JSON parse
   * failures, etc.). Defaults to `console.warn` in development.
   */
  logger?: Logger;
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
  handleUserInput: (req: Request, res: Response) => void;
  handleStream: (req: Request, res: Response) => void;
  destroy: () => void;
}

interface PendingUserInput {
  resolve: (response: UserInputResponse) => void;
  threadId: string;
}

export function createChatHandler(config: ChatHandlerConfig): ChatHandler {
  const logger = config.logger ?? defaultLogger;
  const sessions = new SessionManager();
  const threads = new ThreadStore(config.threadsDir ?? './threads', logger);
  const maxConcurrent = config.maxConcurrentRequests ?? 10;
  const architectures = config.architectures ?? buildDefaultArchitectures();
  const defaultArchitecture = config.defaultArchitecture ?? Object.keys(architectures)[0];
  const validArchitectures = Object.keys(architectures);
  const pendingUserInputs = new Map<string, PendingUserInput>();

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

    // Register per-thread session (broadcast target + replay buffer). When the
    // thread already has an active stream, reject with 409 so the client can
    // wait for it to finish (or join via /api/chat/stream/:threadId).
    const session = sessions.register(threadId, requestId, adapter, architecture);
    if (!session) {
      try { adapter.abort(); } catch { /* ignore */ }
      res.status(409).json({ error: 'STREAM_IN_PROGRESS', threadId });
      return;
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Attach this response as the primary listener. The same broadcast is
    // forwarded to any additional subscribers attached via `handleStream`.
    const detach = sessions.on(threadId, (evt) => {
      try {
        res.write(serializeSSE(evt.type, evt.data, evt.id));
      } catch {
        // Connection already closed; removal-sweep will clean up.
      }
    });

    // Abort on client disconnect — but don't cancel the adapter, let it keep
    // running so late joiners can see the rest of the stream.
    res.on('close', () => {
      detach?.();
    });

    // Collect messages for thread persistence
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const turnStartTimestamp = new Date().toISOString();
    const userMessage: StoredMessage = {
      id: userMessageId,
      role: 'user',
      blocks: [{ type: 'text', text: chatReq.prompt }],
      timestamp: turnStartTimestamp,
    };

    // Send connected + turn_start via broadcast so joiners see them in replay.
    sessions.broadcast(threadId, 'connected', { requestId, threadId });
    sessions.broadcast(threadId, 'turn_start', {
      userMessageId,
      assistantMessageId,
      prompt: chatReq.prompt,
      timestamp: turnStartTimestamp,
    });

    const assistantBlocks: StoredContentBlock[] = [];
    let resultSessionId: string | undefined;
    let resultUsage: WireUsageStats | undefined;

    // Look up existing session for resumption and decide whether the next turn
    // can resume it or needs a fresh session with the transcript replayed
    // through the prompt. See executionPlan.ts for the rules.
    const existingThread = threads.get(threadId);
    const plan = resolveExecutionPlan({
      existingThread,
      requestedArchitecture: architecture,
      requestedModel: model,
      requestedSessionId: chatReq.sessionId,
      prompt: chatReq.prompt,
    });

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
      if (plan.archChanged) updates.architecture = architecture;
      if (plan.modelChanged) updates.model = model;
      if (plan.requiresHistoryReplay) {
        // Drop the stale sessionId now; the new adapter's `result.sessionId`
        // will be persisted by persistTurn() at the end of this turn.
        updates.sessionId = undefined;
      }
      if (Object.keys(updates).length > 0) {
        threads.update(threadId, updates as Parameters<typeof threads.update>[1]);
      }
    }

    const onUserInput = (request: UserInputRequest): Promise<UserInputResponse> => {
      return new Promise<UserInputResponse>((resolvePromise) => {
        pendingUserInputs.set(request.requestId, { resolve: resolvePromise, threadId: threadId! });
      });
    };

    const baseExecuteArgs = {
      systemPrompt: effectiveSystemPrompt,
      model,
      maxTurns: effectiveMaxTurns,
      allowedTools: chatReq.allowedTools,
      cwd: effectiveCwd,
      architectureConfig: effectiveArchitectureConfig,
      planMode: effectivePlanMode,
      onUserInput,
    };

    const consumeStream = async (
      executeArgs: Parameters<RuntimeAdapter['execute']>[0],
    ): Promise<void> => {
      const stream = adapter.execute(executeArgs);
      for await (const event of stream) {
        config.onEvent?.(event, requestId);

        const wireEvent = unifiedEventToWire(event as UnifiedEvent & Record<string, unknown>);
        sessions.broadcast(threadId, wireEvent.type, wireEvent);

        // Collect blocks for persistence
        applyEventToStoredBlocks(assistantBlocks, event);

        if (event.type === 'result') {
          resultSessionId = event.sessionId;
          resultUsage = event.usage;
          if (resultSessionId) sessions.setSessionId(requestId, resultSessionId);
        }
      }
    };

    try {
      try {
        await consumeStream({
          ...baseExecuteArgs,
          prompt: plan.prompt,
          resumeSessionId: plan.resumeSessionId,
        });
      } catch (err) {
        // Adapter resume failures (e.g. codex "no rollout found" — the CLI
        // dropped the rollout for the sessionId we got back last turn) are
        // recoverable: as long as nothing has streamed yet, drop the stale
        // sessionId and replay the transcript through a fresh session.
        if (
          plan.resumeSessionId !== undefined &&
          isResumeFailureError(err) &&
          assistantBlocks.length === 0
        ) {
          logger.warn(
            `handler.handleChat: adapter resume failed; retrying with fresh session and history replay`,
            err,
          );
          threads.update(threadId, { sessionId: undefined });
          const refreshed = threads.get(threadId);
          const fallbackPrompt = buildReplayPromptForFallback(
            refreshed?.messages ?? [],
            chatReq.prompt,
          );
          await consumeStream({
            ...baseExecuteArgs,
            prompt: fallbackPrompt,
            resumeSessionId: undefined,
          });
        } else {
          throw err;
        }
      }
    } catch (err) {
      const wireError = {
        type: 'error' as const,
        error: (err as Error).message ?? String(err),
        code: 'UNKNOWN',
      };
      sessions.broadcast(threadId, 'error', wireError);
    } finally {
      sessions.broadcast(threadId, 'done', {});
      try { res.end(); } catch { /* ignore */ }
      sessions.remove(requestId);

      // Resolve any still-pending user input prompts for this thread as
      // 'cancel' so the adapter stream can unwind cleanly.
      for (const [reqId, pending] of pendingUserInputs) {
        if (pending.threadId === threadId) {
          pending.resolve({ action: 'cancel' });
          pendingUserInputs.delete(reqId);
        }
      }

      persistTurn({
        threads,
        threadId: threadId!,
        userMessage,
        assistantMessageId,
        assistantBlocks,
        resultUsage,
        resultSessionId,
        architecture,
        model,
      });
    }
  };

  const handleUserInput = (req: Request, res: Response): void => {
    const { requestId, response } = req.body as {
      requestId?: string;
      response?: UserInputResponse;
    };
    if (!requestId || typeof requestId !== 'string') {
      res.status(400).json({ error: 'requestId is required' });
      return;
    }
    if (!response || typeof response !== 'object') {
      res.status(400).json({ error: 'response is required' });
      return;
    }
    const pending = pendingUserInputs.get(requestId);
    if (!pending) {
      res.status(404).json({ error: 'No pending request with that ID' });
      return;
    }
    pending.resolve(response);
    pendingUserInputs.delete(requestId);

    // Record the response as a block on the thread so it shows up on reload.
    const thread = threads.get(pending.threadId);
    if (thread) {
      if (attachUserInputResponse(thread.messages, requestId, response)) {
        threads.update(pending.threadId, { messages: thread.messages });
      }
    }
    res.json({ ok: true });
  };

  const handleStream = (req: Request, res: Response): void => {
    const threadId = req.params.threadId as string;
    if (!threadId) {
      res.status(400).json({ error: 'threadId is required' });
      return;
    }
    const session = sessions.getByThread(threadId);
    if (!session) {
      res.status(404).json({ error: 'No active stream for this thread' });
      return;
    }

    // Support `Last-Event-ID` to skip events the client already saw. Browsers
    // set this automatically on EventSource reconnect.
    const lastEventIdHeader = req.header('Last-Event-ID');
    const fromEventId = lastEventIdHeader ? Number.parseInt(lastEventIdHeader, 10) : undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Replay buffered events first (filtered by fromEventId when provided).
    const replay = typeof fromEventId === 'number' && Number.isFinite(fromEventId)
      ? session.replayBuffer.filter(e => e.id > fromEventId)
      : session.replayBuffer;
    for (const evt of replay) {
      try {
        res.write(serializeSSE(evt.type, evt.data, evt.id));
      } catch {
        return;
      }
    }

    // If the session already finished during the grace window, close now so
    // the client can fall back to the replay-only view.
    if (session.removalTimer) {
      try { res.end(); } catch { /* ignore */ }
      return;
    }

    const detach = sessions.on(threadId, (evt) => {
      try {
        res.write(serializeSSE(evt.type, evt.data, evt.id));
        if (evt.type === 'done') {
          try { res.end(); } catch { /* ignore */ }
        }
      } catch {
        // Connection closed
      }
    });

    res.on('close', () => {
      detach?.();
    });
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
    handleUserInput,
    handleStream,
    destroy,
  };
}

// Walk thread messages and attach a response to the matching userInputRequest
// block. Returns true if a block was updated.
function attachUserInputResponse(
  messages: StoredMessage[],
  requestId: string,
  response: UserInputResponse,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i].blocks;
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j];
      if (b.type === 'userInputRequest' && b.requestId === requestId) {
        blocks[j] = { ...b, response };
        return true;
      }
      if (b.type === 'subagent') {
        if (attachUserInputResponse(b.messages, requestId, response)) return true;
      }
    }
  }
  return false;
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

