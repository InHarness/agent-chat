import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';

type QueueUpdatedEvent = Extract<WireEvent, { type: 'queue_updated' }>;

/** Full snapshot of the thread's queue after a mutation (enqueue/delivery/cancel). */
export function handleQueueUpdated(state: ChatState, event: QueueUpdatedEvent): ChatState {
  return { ...state, queuedMessages: event.queued };
}
