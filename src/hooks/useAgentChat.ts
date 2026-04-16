import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatConfig, ChatMessage } from '../types.js';
import type { WireEvent } from '../server/protocol.js';
import { useMessageReducer } from './useMessageReducer.js';
import { useEventStream } from './useEventStream.js';
import { useAgentConfig } from './useAgentConfig.js';
import { useThreads } from './useThreads.js';

export function useAgentChat(chatConfig: AgentChatConfig) {
  const { serverUrl } = chatConfig;

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

  // Track the latest threadId from the server (set on 'connected' event)
  const activeThreadIdRef = useRef<string | null>(null);

  // Threads
  const threadCallbackRef = useRef<(messages: ChatMessage[], sessionId?: string, arch?: string, model?: string, cwd?: string, systemPrompt?: string, maxTurns?: number) => void>(null);
  threadCallbackRef.current = (messages, sessionId, arch, model, threadCwd, threadSystemPrompt, threadMaxTurns) => {
    restoreMessages(messages, sessionId, arch, model);
    if (arch) agentConfig.setArchitecture(arch);
    if (model) agentConfig.setModel(model);
    setActiveCwd(threadCwd ?? null);
    setSystemPrompt(threadSystemPrompt ?? '');
    setMaxTurns(threadMaxTurns);
  };

  const threadHook = useThreads({
    serverUrl,
    onThreadLoaded: useCallback(
      (messages: ChatMessage[], sessionId?: string, arch?: string, model?: string, cwd?: string, systemPrompt?: string, maxTurns?: number) => {
        threadCallbackRef.current?.(messages, sessionId, arch, model, cwd, systemPrompt, maxTurns);
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
  const { startStream, abort: abortStream } = useEventStream({
    serverUrl,
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
    });

    // Refresh thread list after response
    threadHook.refreshThreads();
  }, [sendUserMessage, startStream, threadHook, agentConfig.architecture, agentConfig.model, cwd, systemPrompt, maxTurns]);

  const abort = useCallback(() => {
    abortStream();
    handleWireEvent({ type: 'error', error: 'Request aborted', code: 'ABORTED' });
  }, [abortStream, handleWireEvent]);

  const resetAdvancedOptions = useCallback(() => {
    setCwd('');
    setActiveCwd(null);
    setSystemPrompt('');
    setMaxTurns(undefined);
  }, []);

  const setArchitecture = useCallback((arch: string) => {
    agentConfig.setArchitecture(arch);
    setReducerArchitecture(arch);
    activeThreadIdRef.current = null;
    threadHook.setActiveThreadId(null);
    resetAdvancedOptions();
  }, [agentConfig, setReducerArchitecture, threadHook, resetAdvancedOptions]);

  const setModel = useCallback((mdl: string) => {
    agentConfig.setModel(mdl);
    setReducerModel(mdl);
    activeThreadIdRef.current = null;
    threadHook.setActiveThreadId(null);
    resetAdvancedOptions();
  }, [agentConfig, setReducerModel, threadHook, resetAdvancedOptions]);

  const createThread = useCallback(async () => {
    clear();
    resetAdvancedOptions();
    const id = await threadHook.createThread(agentConfig.architecture, agentConfig.model, {
      cwd: cwd || undefined,
      systemPrompt: systemPrompt || undefined,
      maxTurns,
    });
    if (id) activeThreadIdRef.current = id;
  }, [clear, resetAdvancedOptions, threadHook, agentConfig.architecture, agentConfig.model, cwd, systemPrompt, maxTurns]);

  return {
    // Conversation state
    messages: state.messages,
    isStreaming: state.isStreaming,
    error: state.error,
    usage: state.usage,
    sessionId: state.sessionId,

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

    // Threads
    threads: threadHook.threads,
    activeThreadId: threadHook.activeThreadId,
    createThread,
    loadThread: threadHook.loadThread,
    deleteThread: threadHook.deleteThread,
    renameThread: threadHook.renameThread,

    // Actions
    sendMessage,
    abort,
  };
}
