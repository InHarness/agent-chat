import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { finalizeActiveMessage } from './_shared.js';

type ErrorEvent = Extract<WireEvent, { type: 'error' }>;

// The wire `error` field is typed as a string, but adapter pass-through events
// carry an Error-like object (`{ name, message, cause, ... }`). `new Error(obj)`
// would stringify it to "[object Object]", so coerce defensively.
function toError(raw: unknown): Error {
  if (raw instanceof Error) return raw;
  if (typeof raw === 'string') return new Error(raw);
  if (raw && typeof raw === 'object') {
    const o = raw as { message?: unknown; name?: unknown };
    if (typeof o.message === 'string' && o.message) return new Error(o.message, { cause: raw });
    if (typeof o.name === 'string' && o.name) return new Error(o.name, { cause: raw });
    try {
      return new Error(JSON.stringify(raw), { cause: raw });
    } catch {
      return new Error('Unknown error', { cause: raw });
    }
  }
  return new Error(String(raw ?? 'Unknown error'));
}

export function handleError(state: ChatState, event: ErrorEvent): ChatState {
  return {
    ...state,
    isStreaming: false,
    error: toError(event.error),
    messages: finalizeActiveMessage(state.messages, state.activeAssistantMessageId),
    activeAssistantMessageId: null,
    // Entries now survive `subagent_completed` (see `subagentLifecycle.ts`), so
    // end-of-turn is the only thing that clears them. A turn that ends in an
    // error — Stop/abort dispatches `{ type: 'error', code: 'ABORTED' }` — never
    // reaches `result.ts`, so it must reset the registry itself; otherwise the
    // aborted turn's subagents leak into every turn that follows.
    activeSubagents: new Map(),
  };
}
