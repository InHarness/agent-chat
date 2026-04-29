import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { finalizeActiveMessage } from './_shared.js';

type ErrorEvent = Extract<WireEvent, { type: 'error' }>;

export function handleError(state: ChatState, event: ErrorEvent): ChatState {
  return {
    ...state,
    isStreaming: false,
    error: new Error(event.error),
    messages: finalizeActiveMessage(state.messages, state.activeAssistantMessageId),
    activeAssistantMessageId: null,
  };
}
