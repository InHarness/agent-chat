import { accumulateUsage } from '../../core/usage.js';
import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { closeBlockOnActiveMessage } from './_shared.js';

type ResultEvent = Extract<WireEvent, { type: 'result' }>;

/**
 * `result` closes a BLOCK, not the turn: an adapter may hold the session,
 * wake the model and emit another `result` on the same turn. Only the
 * counters move and the open text/thinking blocks close — the stream stays
 * armed (`isStreaming`, `activeAssistantMessageId`, `activeSubagents`) until
 * `done` or `error`.
 */
export function handleResult(state: ChatState, event: ResultEvent): ChatState {
  return {
    ...state,
    // BILLING — `usage` on a `result` covers that block alone: sum them.
    usage: accumulateUsage(state.usage ?? undefined, event.usage) ?? null,
    // CONTEXT WINDOW — a snapshot: overwrite, never sum. The last one is current.
    contextSize: event.contextSize,
    sessionId: event.sessionId ?? state.sessionId,
    messages: closeBlockOnActiveMessage(state.messages, state.activeAssistantMessageId, event.usage, event.contextSize),
  };
}
