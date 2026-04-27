import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchOption, UserInputResponse } from '@inharness-ai/agent-adapters';
import type { AgentChatConfig, ChatMessage } from '../types.js';
import type { WireEvent } from '../server/protocol.js';
import { useMessageReducer } from './useMessageReducer.js';
import { useEventStream } from './useEventStream.js';
import { useAgentConfig } from './useAgentConfig.js';
import { useThreads } from './useThreads.js';

function buildArchDefaults(options: ArchOption[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const opt of options) {
    if (opt.default !== undefined) result[opt.key] = opt.default;
  }
  return result;
}

export function useAgentChat(chatConfig: AgentChatConfig) {
  const { serverUrl, endpoints } = chatConfig;

  // Config (architectures + models from server)
  const agentConfig = useAgentConfig(serverUrl);

  // Message state
  const {
    state,
    sendUserMessage,
    handleWireEvent,
    restoreMessages,
    setArchitecture: setReducerArchitecture,
    setModel: setReducerModel,
    clear,
  } = useMessageReducer(agentConfig.architecture, agentConfig.model);

  // Advanced options state
  const [cwd, setCwd] = useState('');
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [maxTurns, setMaxTurns] = useState<number | undefined>(undefined);
  const [architectureConfig, setArchitectureConfig] = useState<Record<string, unknown>>({});
  const [planMode, setPlanMode] = useState(false);

  // Track the latest threadId from the server (set on 'connected' event)
  const activeThreadIdRef = useRef<string | null>(null);

  // Threads
  const threadCallbackRef = useRef<(
    messages: ChatMessage[],
    sessionId?: string,
    arch?: string,
    model?: string,
    cwd?: string,
    systemPrompt?: string,
    maxTurns?: number,
    architectureConfig?: Record<string, unknown>,
    planMode?: boolean,
  ) => void>(null);
  threadCallbackRef.current = (messages, sessionId, arch, model, threadCwd, threadSystemPrompt, threadMaxTurns, threadArchConfig, threadPlanMode) => {
    restoreMessages(messages, sessionId, arch, model);
    if (arch) agentConfig.setArchitecture(arch);
    if (model) agentConfig.setModel(model);
    setActiveCwd(threadCwd ?? null);
    setSystemPrompt(threadSystemPrompt ?? '');
    setMaxTurns(threadMaxTurns);
    setArchitectureConfig(threadArchConfig ?? {});
    setPlanMode(threadPlanMode ?? false);
  };

  const threadHook = useThreads({
    serverUrl,
    endpoints: endpoints?.threads,
    onThreadLoaded: useCallback(
      (
        messages: ChatMessage[],
        sessionId?: string,
        arch?: string,
        model?: string,
        cwd?: string,
        systemPrompt?: string,
        maxTurns?: number,
        architectureConfig?: Record<string, unknown>,
        planMode?: boolean,
      ) => {
        threadCallbackRef.current?.(messages, sessionId, arch, model, cwd, systemPrompt, maxTurns, architectureConfig, planMode);
      },
      [],
    ),
  });

  // Load threads on mount
  useEffect(() => {
    threadHook.refreshThreads();
  }, [threadHook.refreshThreads]);

  // Event handlers (stable refs)
  const stateRef = useRef(state);
  stateRef.current = state;

  const onEvent = useCallback((event: WireEvent) => {
    handleWireEvent(event);
  }, [handleWireEvent]);

  const onError = useCallback((error: Error) => {
    handleWireEvent({ type: 'error', error: error.message, code: 'NETWORK_ERROR' });
  }, [handleWireEvent]);

  const onConnected = useCallback((requestId: string, threadId: string) => {
    activeThreadIdRef.current = threadId;
    threadHook.setActiveThreadId(threadId);
  }, [threadHook]);

  // Event stream
  const { startStream, joinStream, abort: abortStream } = useEventStream({
    serverUrl,
    endpoints: endpoints?.stream,
    onEvent,
    onError,
    onConnected,
  });

  // --- Public API ---

  const sendMessage = useCallback(async (text: string) => {
    if (stateRef.current.isStreaming) return;
    if (!text.trim()) return;

    sendUserMessage(text);

    await startStream({
      prompt: text,
      threadId: threadHook.activeThreadId ?? undefined,
      architecture: agentConfig.architecture,
      model: agentConfig.model,
      sessionId: stateRef.current.sessionId ?? undefined,
      cwd: threadHook.activeThreadId ? undefined : cwd || undefined,
      systemPrompt: systemPrompt || undefined,
      maxTurns,
      architectureConfig: Object.keys(architectureConfig).length > 0 ? architectureConfig : undefined,
      planMode: planMode || undefined,
    });

    // Refresh thread list after response
    threadHook.refreshThreads();
  }, [sendUserMessage, startStream, threadHook, agentConfig.architecture, agentConfig.model, cwd, systemPrompt, maxTurns, architectureConfig, planMode]);

  const abort = useCallback(() => {
    abortStream();
    handleWireEvent({ type: 'error', error: 'Request aborted', code: 'ABORTED' });
  }, [abortStream, handleWireEvent]);

  const sendUserInputResponse = useCallback(async (requestId: string, response: UserInputResponse) => {
    // Optimistic local update so the card reflects the answer instantly.
    handleWireEvent({ type: 'user_input_response', requestId, response });
    try {
      const res = await fetch(`${serverUrl}/api/chat/user-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, response }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(err || `user-input failed: ${res.status}`);
      }
    } catch (e) {
      handleWireEvent({
        type: 'error',
        error: (e as Error).message ?? 'Failed to submit user input',
        code: 'USER_INPUT_ERROR',
      });
    }
  }, [serverUrl, handleWireEvent]);

  const resetAdvancedOptions = useCallback((archOverride?: string) => {
    setCwd('');
    setActiveCwd(null);
    setSystemPrompt('');
    setMaxTurns(undefined);
    setPlanMode(false);
    const arch = archOverride ?? agentConfig.architecture;
    const options = agentConfig.config?.architectures[arch]?.options ?? [];
    setArchitectureConfig(buildArchDefaults(options));
  }, [agentConfig.config, agentConfig.architecture]);

  const setArchitecture = useCallback((arch: string) => {
    agentConfig.setArchitecture(arch);
    setReducerArchitecture(arch);
    activeThreadIdRef.current = null;
    threadHook.setActiveThreadId(null);
    resetAdvancedOptions(arch);
  }, [agentConfig, setReducerArchitecture, threadHook, resetAdvancedOptions]);

  const setModel = useCallback((mdl: string) => {
    agentConfig.setModel(mdl);
    setReducerModel(mdl);
    activeThreadIdRef.current = null;
    threadHook.setActiveThreadId(null);
    resetAdvancedOptions();
  }, [agentConfig, setReducerModel, threadHook, resetAdvancedOptions]);

  // Seed architecture-specific defaults on initial config load (when no thread active).
  const seededInitialRef = useRef(false);
  useEffect(() => {
    if (seededInitialRef.current) return;
    if (!agentConfig.config || !agentConfig.architecture) return;
    if (threadHook.activeThreadId) return;
    seededInitialRef.current = true;
    const options = agentConfig.config.architectures[agentConfig.architecture]?.options ?? [];
    setArchitectureConfig(buildArchDefaults(options));
  }, [agentConfig.config, agentConfig.architecture, threadHook.activeThreadId]);

  const createThread = useCallback(async () => {
    clear();
    resetAdvancedOptions();
    const id = await threadHook.createThread(agentConfig.architecture, agentConfig.model, {
      cwd: cwd || undefined,
      systemPrompt: systemPrompt || undefined,
      maxTurns,
      architectureConfig: Object.keys(architectureConfig).length > 0 ? architectureConfig : undefined,
      planMode: planMode || undefined,
    });
    if (id) activeThreadIdRef.current = id;
  }, [clear, resetAdvancedOptions, threadHook, agentConfig.architecture, agentConfig.model, cwd, systemPrompt, maxTurns, architectureConfig, planMode]);

  const loadThread = useCallback(async (threadId: string) => {
    // Load static history first so the UI paints immediately.
    await threadHook.loadThread(threadId);
    // Then attempt to attach to an in-flight stream (if the thread is still
    // live on the server after an F5 / tab switch). 404 is expected when the
    // thread is idle — we silently fall back to the static view.
    if (!stateRef.current.isStreaming) {
      await joinStream(threadId);
    }
  }, [threadHook, joinStream]);

  const archEntry = agentConfig.config?.architectures[agentConfig.architecture];
  const overrideRaw = architectureConfig['context_window_override'];
  const override = typeof overrideRaw === 'number' && Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : undefined;
  const contextWindow = override ?? archEntry?.contextWindows?.[agentConfig.model];

  return {
    // Conversation state
    messages: state.messages,
    isStreaming: state.isStreaming,
    error: state.error,
    usage: state.usage,
    sessionId: state.sessionId,
    contextWindow,
    currentTodoItems: state.currentTodoItems,

    // Config
    config: agentConfig.config,
    configLoading: agentConfig.loading,
    architecture: agentConfig.architecture,
    model: agentConfig.model,
    setArchitecture,
    setModel,

    // Advanced options
    cwd,
    setCwd,
    activeCwd,
    defaultCwd: agentConfig.defaultCwd,
    systemPrompt,
    setSystemPrompt,
    maxTurns,
    setMaxTurns,
    architectureConfig,
    setArchitectureConfig,
    architectureOptions: agentConfig.config?.architectures[agentConfig.architecture]?.options ?? [],
    planMode,
    setPlanMode,

    // Threads
    threads: threadHook.threads,
    activeThreadId: threadHook.activeThreadId,
    createThread,
    loadThread,
    deleteThread: threadHook.deleteThread,
    renameThread: threadHook.renameThread,

    // Actions
    sendMessage,
    abort,
    sendUserInputResponse,
  };
}
