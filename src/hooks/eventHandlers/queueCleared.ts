import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';

type QueueClearedEvent = Extract<WireEvent, { type: 'queue_cleared' }>;

/**
 * The queue was cleared (Stop/abort or explicit clear). Drop the chips here;
 * restoring the texts into the composer is a side-effect handled by the
 * application via `AgentChatConfig.onQueueCleared` (the composer's text state is
 * owned by the component, not the reducer).
 */
export function handleQueueCleared(state: ChatState, _event: QueueClearedEvent): ChatState {
  return { ...state, queuedMessages: [] };
}
