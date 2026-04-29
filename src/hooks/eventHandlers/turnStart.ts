import type { ChatState, ChatMessage } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';

type TurnStartEvent = Extract<WireEvent, { type: 'turn_start' }>;

export function handleTurnStart(state: ChatState, event: TurnStartEvent): ChatState {
  // Duplicate replay of the same turn_start (e.g. SSE reconnect): no-op.
  if (state.activeAssistantMessageId === event.assistantMessageId) return state;
  // Optimistic turn in flight: USER_MESSAGE just dispatched client-side UUIDs,
  // server is now broadcasting its own UUIDs for the same turn. Adopt server
  // IDs onto the existing user+assistant pair so persistence and follow-up
  // events (which reference server IDs) line up. ID equality cannot detect
  // this — client and server pick UUIDs independently — so we rely on
  // `activeAssistantMessageId !== null`, which is set by USER_MESSAGE and
  // cleared by result/error/RESTORE/CLEAR.
  if (state.activeAssistantMessageId !== null) {
    const aIdx = state.messages.findIndex(m => m.id === state.activeAssistantMessageId);
    if (aIdx > 0 && state.messages[aIdx - 1]?.role === 'user') {
      const messages = state.messages.slice();
      messages[aIdx - 1] = { ...messages[aIdx - 1], id: event.userMessageId };
      messages[aIdx] = { ...messages[aIdx], id: event.assistantMessageId };
      return {
        ...state,
        messages,
        activeAssistantMessageId: event.assistantMessageId,
        isStreaming: true,
        error: null,
        usage: null,
      };
    }
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
