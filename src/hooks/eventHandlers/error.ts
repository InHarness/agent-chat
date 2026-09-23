import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { isStreamTornDown, teardownStream } from './_shared.js';

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

// Codes the client dispatches for a failed SIDE request (enqueue, user-input
// answer) while the stream itself is still live on the server. They report
// the error without tearing the stream down — a teardown would make every
// later frame of the still-running turn (text, `result`'s usage and
// sessionId) be dropped, and the next send would collide with the open stream.
const NON_TERMINAL_CODES = new Set(['QUEUE_ERROR', 'USER_INPUT_ERROR']);

export function handleError(state: ChatState, event: ErrorEvent): ChatState {
  const error = toError(event.error);
  if (NON_TERMINAL_CODES.has(event.code)) return { ...state, error };
  // Idempotent teardown: a second terminator (`error` after `error`) only
  // updates the reported error — the stream is already disarmed.
  if (isStreamTornDown(state)) return { ...state, error };
  return { ...teardownStream(state), error };
}
