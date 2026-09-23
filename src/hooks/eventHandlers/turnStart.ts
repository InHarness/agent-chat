import type { ChatState, ChatMessage } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { finalizeActiveMessage, teardownStream } from './_shared.js';

type TurnStartEvent = Extract<WireEvent, { type: 'turn_start' }>;

export function handleTurnStart(state: ChatState, event: TurnStartEvent): ChatState {
  // Duplicate replay of the same turn_start (e.g. SSE reconnect): no-op.
  if (state.activeAssistantMessageId === event.assistantMessageId) return state;
  // Optimistic turn in flight: USER_MESSAGE just dispatched client-side UUIDs,
  // server is now broadcasting its own UUIDs for the same turn. Adopt server
  // IDs onto the existing user+assistant pair so persistence and follow-up
  // events (which reference server IDs) line up. ID equality cannot detect
  // this — client and server pick UUIDs independently — so USER_MESSAGE
  // records the optimistic id and only the first turn_start adopts it.
  if (
    state.activeAssistantMessageId !== null &&
    state.activeAssistantMessageId === state.optimisticAssistantMessageId
  ) {
    const aIdx = state.messages.findIndex(m => m.id === state.activeAssistantMessageId);
    if (aIdx > 0 && state.messages[aIdx - 1]?.role === 'user') {
      const messages = state.messages.slice();
      messages[aIdx - 1] = { ...messages[aIdx - 1], id: event.userMessageId };
      messages[aIdx] = { ...messages[aIdx], id: event.assistantMessageId };
      return {
        ...state,
        messages,
        activeAssistantMessageId: event.assistantMessageId,
        optimisticAssistantMessageId: null,
        isStreaming: true,
        error: null,
      };
    }
  }
  // A turn the thread already holds: a reload (RESTORE) right after the stream
  // ended, then a join inside the server's post-`done` grace window, replays
  // turns that are already on disk. Leave no message active, so the reducer
  // drops the turn's frames (see `dispatchEvent`) instead of appending a
  // duplicate pair — and its `result` is not counted a second time.
  if (state.messages.some(m => m.id === event.assistantMessageId)) {
    return state.activeAssistantMessageId === null ? state : teardownStream(state);
  }
  // A further turn on the same stream (queued messages dispatched after the
  // previous turn), or a fresh join (e.g. F5 during an in-flight stream):
  // finish whatever is active and append a new pair — never rewrite the ids
  // of a finished one.
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
  const hadActive = state.activeAssistantMessageId !== null;
  return {
    ...state,
    messages: [...finalizeActiveMessage(state.messages, state.activeAssistantMessageId), userMsg, assistantMsg],
    activeAssistantMessageId: event.assistantMessageId,
    optimisticAssistantMessageId: null,
    ...(hadActive ? { activeSubagents: new Map() } : {}),
    isStreaming: true,
    error: null,
  };
}
