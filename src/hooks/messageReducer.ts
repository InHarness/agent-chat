import type { ChatState, ChatMessage, TodoItem } from '../types.js';
import type { WireEvent } from '../server/protocol.js';
import { dispatchEvent } from './eventHandlers/index.js';

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
      return dispatchEvent(state, action.event);

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
      // Patch architecture in place; preserve messages, sessionId, usage,
      // active streaming pointers. The server detects the rollover and replays
      // the transcript when needed. sessionId stays around so adapters that
      // tolerate it (claude-code on the same arch) keep cache; on the next
      // turn the server may drop it via effectiveResumeSessionId.
      return { ...state, architecture: action.architecture };

    case 'SET_MODEL':
      return { ...state, model: action.model };

    case 'CLEAR':
      return createInitialState(state.architecture, state.model);

    default:
      return state;
  }
}
