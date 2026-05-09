import { addUsage } from '../../core/usage.js';
import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { finalizeActiveMessage } from './_shared.js';

type ResultEvent = Extract<WireEvent, { type: 'result' }>;

export function handleResult(state: ChatState, event: ResultEvent): ChatState {
  return {
    ...state,
    isStreaming: false,
    // BILLING — sumować przez tury (cost). Niegraniczone.
    usage: state.usage ? addUsage(state.usage, event.usage) : event.usage,
    // CONTEXT WINDOW — overwrite, nigdy nie sumować. Każda tura zwraca
    // post-turn context size, bounded by model window.
    contextSize: event.contextSize,
    sessionId: event.sessionId ?? state.sessionId,
    messages: finalizeActiveMessage(state.messages, state.activeAssistantMessageId, event.usage, event.contextSize),
    activeAssistantMessageId: null,
    activeSubagents: new Map(),
  };
}
