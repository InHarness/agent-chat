import { useReducer, useCallback } from 'react';
import type { ChatState, ChatMessage, UIContentBlock, SubagentState, UsageStats, TodoItem } from '../types.js';
import type { WireEvent } from '../server/protocol.js';
import type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';

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
    currentTodoItems: null,
  };
}

function findLatestTodoItems(messages: ChatMessage[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.blocks.length - 1; j >= 0; j--) {
      const block = msg.blocks[j];
      if (block.type === 'todoList') return block.items;
      if (block.type === 'subagent') {
        const nested = findLatestTodoItems(block.messages);
        if (nested) return nested;
      }
    }
  }
  return null;
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

    case 'RESTORE': {
      const lastAssistantUsage = [...action.messages]
        .reverse()
        .find(m => m.role === 'assistant' && m.usage)?.usage ?? null;
      return {
        ...state,
        messages: action.messages,
        activeAssistantMessageId: null,
        activeSubagents: new Map(),
        isStreaming: false,
        error: null,
        usage: lastAssistantUsage,
        sessionId: action.sessionId ?? null,
        architecture: action.architecture,
        model: action.model,
        currentTodoItems: findLatestTodoItems(action.messages),
      };
    }

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

    case 'turn_start':
      return handleTurnStart(state, event);

    case 'text_delta':
      return handleTextDelta(state, event.text, event.isSubagent, event.subagentTaskId);

    case 'thinking':
      return handleThinking(state, event.text, event.isSubagent, event.replace, event.subagentTaskId);

    case 'tool_use':
      return handleToolUse(state, event);

    case 'tool_result':
      return handleToolResult(state, event.toolUseId, event.summary, event.isSubagent, event.subagentTaskId);

    case 'todo_list_updated':
      return handleTodoListUpdated(state, event);

    case 'user_input_request':
      return handleUserInputRequest(state, event.request);

    case 'user_input_response':
      return handleUserInputResponse(state, event.requestId, event.response);

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

function handleTextDelta(state: ChatState, text: string, isSubagent: boolean, subagentTaskId?: string): ChatState {
  if (isSubagent) {
    return handleSubagentTextDelta(state, text, subagentTaskId);
  }

  return updateActiveMessage(state, (blocks) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'text' && last.isStreaming) {
      return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
    }
    return [...blocks, { type: 'text' as const, text, isStreaming: true }];
  });
}

function handleThinking(state: ChatState, text: string, isSubagent: boolean, replace?: boolean, subagentTaskId?: string): ChatState {
  if (isSubagent) {
    return routeStreamingBlockToSubagent(state, 'thinking', text, replace, subagentTaskId);
  }

  return updateActiveMessage(state, (blocks) => {
    const last = blocks[blocks.length - 1];
    if (!replace && last && last.type === 'thinking' && last.isStreaming) {
      return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
    }
    const finalized = replace && last && last.type === 'thinking' && last.isStreaming
      ? [...blocks.slice(0, -1), { ...last, isStreaming: false }]
      : blocks;
    return [...finalized, { type: 'thinking' as const, text, isStreaming: true, collapsed: false }];
  });
}

function handleToolUse(state: ChatState, event: { toolName: string; toolUseId: string; input: unknown; isSubagent: boolean; subagentTaskId?: string }): ChatState {
  if (event.isSubagent) {
    return routeBlockToSubagent(state, {
      type: 'toolUse' as const,
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      input: event.input,
      collapsed: true,
    }, true, event.subagentTaskId);
  }

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
      collapsed: true,
    }];
  });
}

function handleToolResult(state: ChatState, toolUseId: string, summary: string, isSubagent: boolean, subagentTaskId?: string): ChatState {
  if (isSubagent) {
    return routeToolResultToSubagent(state, toolUseId, summary, subagentTaskId);
  }

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

function handleTodoListUpdated(
  state: ChatState,
  event: { items: TodoItem[]; source: 'model-tool' | 'session-state'; isSubagent: boolean; subagentTaskId?: string },
): ChatState {
  if (event.isSubagent) {
    const routed = routeBlockToSubagent(
      state,
      { type: 'todoList', items: event.items },
      true,
      event.subagentTaskId,
      'todoList',
    );
    return { ...routed, currentTodoItems: event.items };
  }

  const updated = updateActiveMessage(state, (blocks) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'todoList') {
      return [...blocks.slice(0, -1), { type: 'todoList' as const, items: event.items }];
    }
    // Append path: finalize any streaming text/thinking first.
    const finalized = blocks.map(b =>
      (b.type === 'text' || b.type === 'thinking') && b.isStreaming
        ? { ...b, isStreaming: false }
        : b,
    );
    return [...finalized, { type: 'todoList' as const, items: event.items }];
  });

  return { ...updated, currentTodoItems: event.items };
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
      toolUseId: event.toolUseId,
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

function handleSubagentCompleted(state: ChatState, event: { taskId: string; status: string; summary?: string; usage?: UsageStats }): ChatState {
  const newSubagents = new Map(state.activeSubagents);
  newSubagents.delete(event.taskId);

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => blocks.map(b =>
      b.type === 'subagent' && b.taskId === event.taskId
        ? { ...b, status: event.status, summary: event.summary, usage: event.usage }
        : b
    ),
  );
}

function getActiveSubagent(state: ChatState): SubagentState | null {
  const running = Array.from(state.activeSubagents.values()).filter(s => s.status === 'running');
  return running.length > 0 ? running[running.length - 1] : null;
}

function resolveSubagent(state: ChatState, subagentTaskId?: string): SubagentState | null {
  if (subagentTaskId) {
    const byId = state.activeSubagents.get(subagentTaskId);
    if (byId) return byId;
  }
  return getActiveSubagent(state);
}

function routeBlockToSubagent(
  state: ChatState,
  block: UIContentBlock,
  finalizeStreaming = false,
  subagentTaskId?: string,
  upsertLastIfType?: UIContentBlock['type'],
): ChatState {
  const activeSubagent = resolveSubagent(state, subagentTaskId);
  if (!activeSubagent) return state;

  return updateActiveMessage(state, (blocks) =>
    blocks.map(b => {
      if (b.type !== 'subagent' || b.taskId !== activeSubagent.taskId) return b;

      const subMessages = [...b.messages];
      const lastMsg = subMessages[subMessages.length - 1];

      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
        let updatedBlocks = lastMsg.blocks;
        const lastBlock = updatedBlocks[updatedBlocks.length - 1];
        if (upsertLastIfType && lastBlock && lastBlock.type === upsertLastIfType) {
          updatedBlocks = [...updatedBlocks.slice(0, -1), block];
          subMessages[subMessages.length - 1] = { ...lastMsg, blocks: updatedBlocks };
          return { ...b, messages: subMessages };
        }
        if (finalizeStreaming) {
          updatedBlocks = updatedBlocks.map(bl =>
            (bl.type === 'text' || bl.type === 'thinking') && bl.isStreaming
              ? { ...bl, isStreaming: false }
              : bl
          );
        }
        subMessages[subMessages.length - 1] = { ...lastMsg, blocks: [...updatedBlocks, block] };
      } else {
        subMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          blocks: [block],
          timestamp: new Date().toISOString(),
          isStreaming: true,
        });
      }

      return { ...b, messages: subMessages };
    }),
  );
}

function routeStreamingBlockToSubagent(state: ChatState, blockType: 'text' | 'thinking', text: string, replace?: boolean, subagentTaskId?: string): ChatState {
  const activeSubagent = resolveSubagent(state, subagentTaskId);
  if (!activeSubagent) return state;

  return updateActiveMessage(state, (blocks) =>
    blocks.map(b => {
      if (b.type !== 'subagent' || b.taskId !== activeSubagent.taskId) return b;

      const subMessages = [...b.messages];
      const lastMsg = subMessages[subMessages.length - 1];

      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
        const lastBlock = lastMsg.blocks[lastMsg.blocks.length - 1];
        if (!replace && lastBlock && lastBlock.type === blockType && lastBlock.isStreaming) {
          const updatedBlocks = [...lastMsg.blocks.slice(0, -1), { ...lastBlock, text: lastBlock.text + text }];
          subMessages[subMessages.length - 1] = { ...lastMsg, blocks: updatedBlocks };
        } else {
          const priorBlocks = replace && lastBlock && lastBlock.type === blockType && lastBlock.isStreaming
            ? [...lastMsg.blocks.slice(0, -1), { ...lastBlock, isStreaming: false }]
            : lastMsg.blocks;
          const newBlock = blockType === 'thinking'
            ? { type: 'thinking' as const, text, isStreaming: true, collapsed: false }
            : { type: 'text' as const, text, isStreaming: true };
          subMessages[subMessages.length - 1] = { ...lastMsg, blocks: [...priorBlocks, newBlock] };
        }
      } else {
        const newBlock = blockType === 'thinking'
          ? { type: 'thinking' as const, text, isStreaming: true, collapsed: false }
          : { type: 'text' as const, text, isStreaming: true };
        subMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          blocks: [newBlock],
          timestamp: new Date().toISOString(),
          isStreaming: true,
        });
      }

      return { ...b, messages: subMessages };
    }),
  );
}

function routeToolResultToSubagent(state: ChatState, toolUseId: string, summary: string, subagentTaskId?: string): ChatState {
  const activeSubagent = resolveSubagent(state, subagentTaskId);
  if (!activeSubagent) return state;

  return updateActiveMessage(state, (blocks) =>
    blocks.map(b => {
      if (b.type !== 'subagent' || b.taskId !== activeSubagent.taskId) return b;

      const subMessages = b.messages.map(msg => {
        if (msg.role !== 'assistant') return msg;
        return {
          ...msg,
          blocks: msg.blocks.map(bl =>
            bl.type === 'toolUse' && bl.toolUseId === toolUseId
              ? { ...bl, collapsed: true }
              : bl
          ),
        };
      });

      const lastMsg = subMessages[subMessages.length - 1];
      const resultBlock: UIContentBlock = {
        type: 'toolResult' as const,
        toolUseId,
        content: summary,
        isError: false,
        collapsed: true,
      };

      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
        subMessages[subMessages.length - 1] = { ...lastMsg, blocks: [...lastMsg.blocks, resultBlock] };
      } else {
        subMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          blocks: [resultBlock],
          timestamp: new Date().toISOString(),
          isStreaming: true,
        });
      }

      return { ...b, messages: subMessages };
    }),
  );
}

function handleSubagentTextDelta(state: ChatState, text: string, subagentTaskId?: string): ChatState {
  return routeStreamingBlockToSubagent(state, 'text', text, undefined, subagentTaskId);
}

function handleTurnStart(
  state: ChatState,
  event: { userMessageId: string; assistantMessageId: string; prompt: string; timestamp: string },
): ChatState {
  // If we already have this assistant turn active (normal POST path or duplicate
  // replay on stream rejoin), don't duplicate.
  if (state.activeAssistantMessageId === event.assistantMessageId) return state;
  // If the user message is already present (local optimistic dispatch), just
  // adopt the server-side assistant id and mark streaming.
  if (state.messages.some(m => m.id === event.userMessageId)) {
    return {
      ...state,
      activeAssistantMessageId: event.assistantMessageId,
      isStreaming: true,
      messages: state.messages.map(m =>
        m.role === 'assistant' && m.id === state.activeAssistantMessageId && m.isStreaming
          ? { ...m, id: event.assistantMessageId }
          : m
      ),
    };
  }
  // Fresh join (e.g. F5 during an in-flight stream): synthesize both messages.
  const userMsg: ChatMessage = {
    id: event.userMessageId,
    role: 'user',
    blocks: [{ type: 'text', text: event.prompt, isStreaming: false }],
    timestamp: event.timestamp,
    isStreaming: false,
  };
  const assistantMsg: ChatMessage = {
    id: event.assistantMessageId,
    role: 'assistant',
    blocks: [],
    timestamp: event.timestamp,
    isStreaming: true,
  };
  return {
    ...state,
    messages: [...state.messages, userMsg, assistantMsg],
    activeAssistantMessageId: event.assistantMessageId,
    isStreaming: true,
    error: null,
    usage: null,
  };
}

function handleUserInputRequest(state: ChatState, request: UserInputRequest): ChatState {
  return updateActiveMessage(state, (blocks) => {
    // Finalize any streaming text/thinking blocks.
    const finalized = blocks.map(b =>
      (b.type === 'text' || b.type === 'thinking') && b.isStreaming
        ? { ...b, isStreaming: false }
        : b
    );
    return [...finalized, { type: 'userInputRequest' as const, requestId: request.requestId, request }];
  });
}

function updateUserInputRequestBlocks(
  blocks: UIContentBlock[],
  requestId: string,
  response: UserInputResponse,
): { blocks: UIContentBlock[]; updated: boolean } {
  let updated = false;
  const next = blocks.map(b => {
    if (b.type === 'userInputRequest' && b.requestId === requestId) {
      updated = true;
      return { ...b, response };
    }
    if (b.type === 'subagent') {
      const nestedMessages = b.messages.map(msg => {
        const res = updateUserInputRequestBlocks(msg.blocks, requestId, response);
        if (res.updated) updated = true;
        return res.updated ? { ...msg, blocks: res.blocks } : msg;
      });
      return { ...b, messages: nestedMessages };
    }
    return b;
  });
  return { blocks: next, updated };
}

function handleUserInputResponse(state: ChatState, requestId: string, response: UserInputResponse): ChatState {
  return {
    ...state,
    messages: state.messages.map(msg => {
      const res = updateUserInputRequestBlocks(msg.blocks, requestId, response);
      return res.updated ? { ...msg, blocks: res.blocks } : msg;
    }),
  };
}

function handleResult(state: ChatState, event: { output: string; usage: UsageStats; sessionId?: string }): ChatState {
  return {
    ...state,
    isStreaming: false,
    usage: event.usage,
    sessionId: event.sessionId ?? state.sessionId,
    messages: finalizeActiveMessage(state.messages, state.activeAssistantMessageId, event.usage),
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

function finalizeActiveMessage(messages: ChatMessage[], activeId: string | null, usage?: UsageStats): ChatMessage[] {
  if (!activeId) return messages;
  return messages.map(msg => {
    if (msg.id !== activeId) return msg;
    return {
      ...msg,
      isStreaming: false,
      ...(usage ? { usage } : {}),
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
