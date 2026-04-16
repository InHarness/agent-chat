import { useReducer, useCallback } from 'react';
import type { ChatState, ChatMessage, UIContentBlock, SubagentState, UsageStats } from '../types.js';
import type { WireEvent } from '../server/protocol.js';

// --- Actions ---

export type MessageAction =
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'EVENT'; event: WireEvent }
  | { type: 'RESTORE'; messages: ChatMessage[]; sessionId?: string; architecture: string; model: string }
  | { type: 'SET_ARCHITECTURE'; architecture: string }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'CLEAR' };

// --- Initial State ---

export function createInitialState(architecture: string, model: string): ChatState {
  return {
    messages: [],
    activeAssistantMessageId: null,
    activeSubagents: new Map(),
    isStreaming: false,
    error: null,
    usage: null,
    sessionId: null,
    architecture,
    model,
  };
}

// --- Reducer ---

export function messageReducer(state: ChatState, action: MessageAction): ChatState {
  switch (action.type) {
    case 'USER_MESSAGE': {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        blocks: [{ type: 'text', text: action.text, isStreaming: false }],
        timestamp: new Date().toISOString(),
        isStreaming: false,
      };
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        blocks: [],
        timestamp: new Date().toISOString(),
        isStreaming: true,
      };
      return {
        ...state,
        messages: [...state.messages, userMsg, assistantMsg],
        activeAssistantMessageId: assistantMsg.id,
        isStreaming: true,
        error: null,
        usage: null,
      };
    }

    case 'EVENT':
      return handleEvent(state, action.event);

    case 'RESTORE':
      return {
        ...state,
        messages: action.messages,
        activeAssistantMessageId: null,
        activeSubagents: new Map(),
        isStreaming: false,
        error: null,
        usage: null,
        sessionId: action.sessionId ?? null,
        architecture: action.architecture,
        model: action.model,
      };

    case 'SET_ARCHITECTURE':
      return {
        ...createInitialState(action.architecture, state.model),
        model: state.model,
      };

    case 'SET_MODEL':
      return {
        ...createInitialState(state.architecture, action.model),
      };

    case 'CLEAR':
      return createInitialState(state.architecture, state.model);

    default:
      return state;
  }
}

// --- Event handling ---

function handleEvent(state: ChatState, event: WireEvent): ChatState {
  switch (event.type) {
    case 'connected':
      return state; // No state change needed

    case 'text_delta':
      return handleTextDelta(state, event.text, event.isSubagent);

    case 'thinking':
      return handleThinking(state, event.text, event.isSubagent);

    case 'tool_use':
      return handleToolUse(state, event);

    case 'tool_result':
      return handleToolResult(state, event.toolUseId, event.summary);

    case 'assistant_message':
      return state; // We build from deltas, don't need to replace

    case 'subagent_started':
      return handleSubagentStarted(state, event);

    case 'subagent_progress':
      return handleSubagentProgress(state, event);

    case 'subagent_completed':
      return handleSubagentCompleted(state, event);

    case 'result':
      return handleResult(state, event);

    case 'error':
      return {
        ...state,
        isStreaming: false,
        error: new Error(event.error),
        messages: finalizeActiveMessage(state.messages, state.activeAssistantMessageId),
        activeAssistantMessageId: null,
      };

    case 'flush':
    case 'done':
      return state;

    default:
      return state;
  }
}

function handleTextDelta(state: ChatState, text: string, isSubagent: boolean): ChatState {
  if (isSubagent) {
    return handleSubagentTextDelta(state, text);
  }

  return updateActiveMessage(state, (blocks) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'text' && last.isStreaming) {
      return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
    }
    return [...blocks, { type: 'text' as const, text, isStreaming: true }];
  });
}

function handleThinking(state: ChatState, text: string, isSubagent: boolean): ChatState {
  if (isSubagent) return state; // Skip subagent thinking for now

  return updateActiveMessage(state, (blocks) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'thinking' && last.isStreaming) {
      return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
    }
    return [...blocks, { type: 'thinking' as const, text, isStreaming: true, collapsed: false }];
  });
}

function handleToolUse(state: ChatState, event: { toolName: string; toolUseId: string; input: unknown; isSubagent: boolean }): ChatState {
  if (event.isSubagent) return state;

  return updateActiveMessage(state, (blocks) => {
    // Finalize any streaming text/thinking blocks
    const finalized = blocks.map(b =>
      (b.type === 'text' || b.type === 'thinking') && b.isStreaming
        ? { ...b, isStreaming: false }
        : b
    );
    return [...finalized, {
      type: 'toolUse' as const,
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      input: event.input,
      collapsed: false,
    }];
  });
}

function handleToolResult(state: ChatState, toolUseId: string, summary: string): ChatState {
  return updateActiveMessage(state, (blocks) => {
    // Collapse the matching toolUse block
    const updated = blocks.map(b =>
      b.type === 'toolUse' && b.toolUseId === toolUseId
        ? { ...b, collapsed: true }
        : b
    );
    return [...updated, {
      type: 'toolResult' as const,
      toolUseId,
      content: summary,
      isError: false,
      collapsed: true,
    }];
  });
}

function handleSubagentStarted(state: ChatState, event: { taskId: string; description: string; toolUseId: string }): ChatState {
  const newSubagents = new Map(state.activeSubagents);
  newSubagents.set(event.taskId, {
    taskId: event.taskId,
    description: event.description,
    toolUseId: event.toolUseId,
    status: 'running',
  });

  const newState = updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => [...blocks, {
      type: 'subagent' as const,
      taskId: event.taskId,
      description: event.description,
      status: 'running',
      messages: [],
    }],
  );

  return newState;
}

function handleSubagentProgress(state: ChatState, event: { taskId: string; description: string; lastToolName?: string }): ChatState {
  const sub = state.activeSubagents.get(event.taskId);
  if (!sub) return state;

  const newSubagents = new Map(state.activeSubagents);
  newSubagents.set(event.taskId, { ...sub, description: event.description, lastToolName: event.lastToolName });

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => blocks.map(b =>
      b.type === 'subagent' && b.taskId === event.taskId
        ? { ...b, description: event.description }
        : b
    ),
  );
}

function handleSubagentCompleted(state: ChatState, event: { taskId: string; status: string; summary?: string }): ChatState {
  const newSubagents = new Map(state.activeSubagents);
  newSubagents.delete(event.taskId);

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => blocks.map(b =>
      b.type === 'subagent' && b.taskId === event.taskId
        ? { ...b, status: event.status, summary: event.summary }
        : b
    ),
  );
}

function handleSubagentTextDelta(state: ChatState, text: string): ChatState {
  // Route to the most recently started running subagent
  const runningSubagents = Array.from(state.activeSubagents.values()).filter(s => s.status === 'running');
  if (runningSubagents.length === 0) return state;
  const activeSubagent = runningSubagents[runningSubagents.length - 1];

  return updateActiveMessage(state, (blocks) =>
    blocks.map(b => {
      if (b.type !== 'subagent' || b.taskId !== activeSubagent.taskId) return b;

      const subMessages = [...b.messages];
      const lastMsg = subMessages[subMessages.length - 1];

      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
        const lastBlock = lastMsg.blocks[lastMsg.blocks.length - 1];
        if (lastBlock && lastBlock.type === 'text' && lastBlock.isStreaming) {
          const updatedBlocks = [...lastMsg.blocks.slice(0, -1), { ...lastBlock, text: lastBlock.text + text }];
          subMessages[subMessages.length - 1] = { ...lastMsg, blocks: updatedBlocks };
        } else {
          const updatedBlocks = [...lastMsg.blocks, { type: 'text' as const, text, isStreaming: true }];
          subMessages[subMessages.length - 1] = { ...lastMsg, blocks: updatedBlocks };
        }
      } else {
        subMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          blocks: [{ type: 'text' as const, text, isStreaming: true }],
          timestamp: new Date().toISOString(),
          isStreaming: true,
        });
      }

      return { ...b, messages: subMessages };
    }),
  );
}

function handleResult(state: ChatState, event: { output: string; usage: { inputTokens: number; outputTokens: number }; sessionId?: string }): ChatState {
  return {
    ...state,
    isStreaming: false,
    usage: event.usage,
    sessionId: event.sessionId ?? state.sessionId,
    messages: finalizeActiveMessage(state.messages, state.activeAssistantMessageId),
    activeAssistantMessageId: null,
    activeSubagents: new Map(),
  };
}

// --- Helpers ---

function updateActiveMessage(state: ChatState, updater: (blocks: UIContentBlock[]) => UIContentBlock[]): ChatState {
  if (!state.activeAssistantMessageId) return state;

  return {
    ...state,
    messages: state.messages.map(msg =>
      msg.id === state.activeAssistantMessageId
        ? { ...msg, blocks: updater(msg.blocks) }
        : msg
    ),
  };
}

function finalizeActiveMessage(messages: ChatMessage[], activeId: string | null): ChatMessage[] {
  if (!activeId) return messages;
  return messages.map(msg => {
    if (msg.id !== activeId) return msg;
    return {
      ...msg,
      isStreaming: false,
      blocks: msg.blocks.map(b => {
        if ((b.type === 'text' || b.type === 'thinking') && b.isStreaming) {
          return { ...b, isStreaming: false };
        }
        return b;
      }),
    };
  });
}

// --- Hook ---

export function useMessageReducer(architecture: string, model: string) {
  const [state, dispatch] = useReducer(messageReducer, createInitialState(architecture, model));

  const sendUserMessage = useCallback((text: string) => {
    dispatch({ type: 'USER_MESSAGE', text });
  }, []);

  const handleWireEvent = useCallback((event: WireEvent) => {
    dispatch({ type: 'EVENT', event });
  }, []);

  const restoreMessages = useCallback((messages: ChatMessage[], sessionId?: string, arch?: string, mdl?: string) => {
    dispatch({ type: 'RESTORE', messages, sessionId, architecture: arch ?? architecture, model: mdl ?? model });
  }, [architecture, model]);

  const setArchitecture = useCallback((arch: string) => {
    dispatch({ type: 'SET_ARCHITECTURE', architecture: arch });
  }, []);

  const setModel = useCallback((mdl: string) => {
    dispatch({ type: 'SET_MODEL', model: mdl });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  return {
    state,
    sendUserMessage,
    handleWireEvent,
    restoreMessages,
    setArchitecture,
    setModel,
    clear,
  };
}
