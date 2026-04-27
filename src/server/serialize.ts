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
        sessionId: rest.sessionId as string | undefined,
      };
    }
    case 'error': {
      const err = event.error as Error;
      return {
        type: 'error',
        error: err?.message ?? String(err),
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
