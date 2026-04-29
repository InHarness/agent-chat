import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { finalizeActiveMessage } from './_shared.js';

type ResultEvent = Extract<WireEvent, { type: 'result' }>;

export function handleResult(state: ChatState, event: ResultEvent): ChatState {
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
