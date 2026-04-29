import { useCallback, useEffect, useRef } from 'react';
import type { ArchOption } from '@inharness-ai/agent-adapters';
import type { AgentChatConfig } from '../types.js';
import { storedMessageToChat } from '../types.js';
import type { WireEvent } from '../server/protocol.js';
import { useMessageReducer } from './useMessageReducer.js';
import { useEventStream } from './useEventStream.js';
import { useAgentConfig } from './useAgentConfig.js';
import { useThreads } from './useThreads.js';
import { useAdvancedOptions } from './useAdvancedOptions.js';
import { useChatActions } from './useChatActions.js';

export function useAgentChat(chatConfig: AgentChatConfig) {
  const { serverUrl, endpoints, logger } = chatConfig;

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

  // Threads
  const threadHook = useThreads({
    serverUrl,
    endpoints: endpoints?.threads,
    logger,
  });

  // Architecture options lookup (stable across renders that don't change config).
  const getArchOptions = useCallback((arch: string): ArchOption[] => {
    return agentConfig.config?.architectures[arch]?.options ?? [];
  }, [agentConfig.config]);

  // Advanced options (cwd, systemPrompt, maxTurns, architectureConfig, planMode)
  const advanced = useAdvancedOptions({
    architecture: agentConfig.architecture,
    configReady: !!agentConfig.config,
    activeThreadId: threadHook.activeThreadId,
    getArchOptions,
  });

  // Track the latest threadId from the server (set on 'connected' event)
  const activeThreadIdRef = useRef<string | null>(null);

  // Event handlers (stable refs)
  const stateRef = useRef(state);
  stateRef.current = state;

  const onEvent = useCallback((event: WireEvent) => {
    handleWireEvent(event);
  }, [handleWireEvent]);

  const onError = useCallback((error: Error) => {
    handleWireEvent({ type: 'error', error: error.message, code: 'NETWORK_ERROR' });
  }, [handleWireEvent]);

  const onConnected = useCallback((_requestId: string, threadId: string) => {
    activeThreadIdRef.current = threadId;
    threadHook.setActiveThreadId(threadId);
  }, [threadHook]);

  // Event stream
  const { startStream, joinStream, abort: abortStream } = useEventStream({
    serverUrl,
    endpoints: endpoints?.stream,
    logger,
    onEvent,
    onError,
    onConnected,
  });

  // Load threads on mount
  useEffect(() => {
    threadHook.refreshThreads();
  }, [threadHook.refreshThreads]);

  // Snapshot getter for chat actions (avoids passing 8 separate dependencies).
  const getRequest = useCallback(() => ({
    activeThreadId: threadHook.activeThreadId,
    architecture: agentConfig.architecture,
    model: agentConfig.model,
    cwd: advanced.cwd,
    systemPrompt: advanced.systemPrompt,
    maxTurns: advanced.maxTurns,
    architectureConfig: advanced.architectureConfig,
    planMode: advanced.planMode,
  }), [
    threadHook.activeThreadId,
    agentConfig.architecture,
    agentConfig.model,
    advanced.cwd,
    advanced.systemPrompt,
    advanced.maxTurns,
    advanced.architectureConfig,
    advanced.planMode,
  ]);

  // Actions (sendMessage, abort, sendUserInputResponse)
  const { sendMessage, abort, sendUserInputResponse } = useChatActions({
    serverUrl,
    stateRef,
    sendUserMessage,
    handleWireEvent,
    startStream,
    abortStream,
    refreshThreads: threadHook.refreshThreads,
    getRequest,
  });

  const setArchitecture = useCallback((arch: string) => {
    agentConfig.setArchitecture(arch);
    setReducerArchitecture(arch);
    // Stay on the current thread. The server detects the architecture rollover
    // and replays the transcript through the new adapter's prompt; messages
    // remain visible in the UI.
    advanced.resetAdvancedOptions(arch);
  }, [agentConfig, setReducerArchitecture, advanced]);

  const setModel = useCallback((mdl: string) => {
    agentConfig.setModel(mdl);
    setReducerModel(mdl);
    // Stay on the current thread; per-architecture options remain valid.
  }, [agentConfig, setReducerModel]);

  const createThread = useCallback(async () => {
    clear();
    advanced.resetAdvancedOptions();
    const id = await threadHook.createThread(agentConfig.architecture, agentConfig.model, {
      cwd: advanced.cwd || undefined,
      systemPrompt: advanced.systemPrompt || undefined,
      maxTurns: advanced.maxTurns,
      architectureConfig: Object.keys(advanced.architectureConfig).length > 0 ? advanced.architectureConfig : undefined,
      planMode: advanced.planMode || undefined,
    });
    if (id) activeThreadIdRef.current = id;
  }, [clear, advanced, threadHook, agentConfig.architecture, agentConfig.model]);

  const loadThread = useCallback(async (threadId: string) => {
    const thread = await threadHook.loadThread(threadId);
    if (thread) {
      const messages = thread.messages.map(storedMessageToChat);
      restoreMessages(messages, thread.sessionId, thread.architecture, thread.model);
      if (thread.architecture) agentConfig.setArchitecture(thread.architecture);
      if (thread.model) agentConfig.setModel(thread.model);
      advanced.setActiveCwd(thread.cwd ?? null);
      advanced.setSystemPrompt(thread.systemPrompt ?? '');
      advanced.setMaxTurns(thread.maxTurns);
      advanced.setArchitectureConfig(thread.architectureConfig ?? {});
      advanced.setPlanMode(thread.planMode ?? false);
    }
    // Then attempt to attach to an in-flight stream (if the thread is still
    // live on the server after an F5 / tab switch). 404 is expected when the
    // thread is idle — we silently fall back to the static view.
    if (!stateRef.current.isStreaming) {
      await joinStream(threadId);
    }
  }, [threadHook, restoreMessages, agentConfig, advanced, joinStream]);

  const deleteThread = useCallback(async (threadId: string) => {
    const { deletedActive } = await threadHook.deleteThread(threadId);
    if (deletedActive) {
      clear();
      advanced.resetAdvancedOptions();
    }
  }, [threadHook, clear, advanced]);

  const archEntry = agentConfig.config?.architectures[agentConfig.architecture];
  const overrideRaw = advanced.architectureConfig['context_window_override'];
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
    cwd: advanced.cwd,
    setCwd: advanced.setCwd,
    activeCwd: advanced.activeCwd,
    defaultCwd: agentConfig.defaultCwd,
    systemPrompt: advanced.systemPrompt,
    setSystemPrompt: advanced.setSystemPrompt,
    maxTurns: advanced.maxTurns,
    setMaxTurns: advanced.setMaxTurns,
    architectureConfig: advanced.architectureConfig,
    setArchitectureConfig: advanced.setArchitectureConfig,
    architectureOptions: archEntry?.options ?? [],
    planMode: advanced.planMode,
    setPlanMode: advanced.setPlanMode,

    // Threads
    threads: threadHook.threads,
    activeThreadId: threadHook.activeThreadId,
    createThread,
    loadThread,
    deleteThread,
    renameThread: threadHook.renameThread,

    // Actions
    sendMessage,
    abort,
    sendUserInputResponse,
  };
}
