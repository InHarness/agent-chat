import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { isStreamTornDown, teardownStream } from './_shared.js';

type DoneEvent = Extract<WireEvent, { type: 'done' }>;

/**
 * `done` ends the stream — the one place (with `error`) that disarms it.
 * Idempotent: a `done` after `error`, or a second `done`, returns the same
 * state object. `error` is left as it is.
 */
export function handleDone(state: ChatState, _event: DoneEvent): ChatState {
  if (isStreamTornDown(state)) return state;
  return teardownStream(state);
}
