import type { WireEvent } from './protocol.js';

// Types from @inharness-ai/agent-adapters (imported dynamically to avoid bundling)
interface UnifiedEvent {
  type: string;
  [key: string]: unknown;
}

export function serializeSSE(event: string, data: unknown, id?: number): string {
  const lines: string[] = [`event: ${event}`];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`data: ${JSON.stringify(data)}`, '', '');
  return lines.join('\n');
}

export function unifiedEventToWire(event: UnifiedEvent): WireEvent {
  switch (event.type) {
    case 'result': {
      // Explicitly strip adapter-side fields that don't belong on the wire:
      // - rawMessages: full message log, already streamed via individual events.
      // - todoListSnapshot: redundant — client reducer reconstructs from `todo_list_updated` events.
      const { rawMessages, todoListSnapshot, ...rest } = event as Record<string, unknown>;
      return {
        type: 'result',
        output: rest.output as string,
        usage: rest.usage as { inputTokens: number; outputTokens: number },
        contextSize: rest.contextSize as number,
        sessionId: rest.sessionId as string | undefined,
      };
    }
    case 'error': {
      const err = event.error as (Error & { cause?: unknown }) | undefined;
      // Adapter pass-through errors are not always real `Error` instances: a
      // structured-cloned or JSON-round-tripped one arrives as a plain object,
      // and `String(obj)` yields "[object Object]". Fall back to `name` before
      // giving up on a readable message.
      const baseMsg =
        typeof err?.message === 'string' && err.message ? err.message :
        typeof err?.name === 'string' && err.name ? err.name :
        String(err);
      const causeMsg =
        err?.cause instanceof Error ? err.cause.message :
        typeof err?.cause === 'string' ? err.cause : undefined;
      const message =
        causeMsg && !baseMsg.includes(causeMsg) ? `${baseMsg}: ${causeMsg}` : baseMsg;
      return {
        type: 'error',
        error: message,
        code: errorToCode(err),
      };
    }
    case 'assistant_message': {
      const msg = event.message as Record<string, unknown>;
      const { native, ...cleanMsg } = msg;
      return { type: 'assistant_message', message: cleanMsg } as unknown as WireEvent;
    }
    case 'user_input_request': {
      // Strip `native` (adapter-specific raw SDK request) — not JSON-safe and
      // not useful client-side.
      const req = event.request as Record<string, unknown>;
      const { native, ...cleanReq } = req;
      return { type: 'user_input_request', request: cleanReq } as unknown as WireEvent;
    }
    case 'user_message': {
      // agent-adapters ≥0.7.0 emits `timestamp` as epoch-ms (number). Map it to
      // an ISO string so it stays consistent with `turn_start.timestamp`.
      const ts = event.timestamp;
      const timestamp = typeof ts === 'number' ? new Date(ts).toISOString() : String(ts ?? '');
      return { type: 'user_message', text: String(event.text ?? ''), timestamp };
    }
    default:
      return event as WireEvent;
  }
}

function errorToCode(err: unknown): string {
  if (!err || typeof err !== 'object') return 'UNKNOWN';
  const name = (err as { name?: string }).name ?? '';
  if (name === 'AdapterTimeoutError') return 'ADAPTER_TIMEOUT';
  if (name === 'AdapterAbortError') return 'ABORTED';
  if (name === 'AdapterInitError') return 'INIT_ERROR';
  if (name === 'AdapterError') return 'ADAPTER_ERROR';
  return 'UNKNOWN';
}
