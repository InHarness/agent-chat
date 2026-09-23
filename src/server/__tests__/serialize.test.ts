import { describe, expect, it } from 'vitest';
import { unifiedEventToWire } from '../serialize.js';
import {
  AdapterAbortError,
  AdapterBackgroundHoldExpiredError,
  AdapterIdleTimeoutError,
  AdapterSubagentTimeoutError,
  AdapterTimeoutError,
  AdapterToolCallTimeoutError,
} from '@inharness-ai/agent-adapters';

describe('unifiedEventToWire — user_message', () => {
  it('maps epoch-ms timestamp (number) to an ISO string', () => {
    const epoch = 1_700_000_000_000;
    const wire = unifiedEventToWire({ type: 'user_message', text: 'hello', timestamp: epoch });
    expect(wire).toEqual({
      type: 'user_message',
      text: 'hello',
      timestamp: new Date(epoch).toISOString(),
    });
  });

  it('passes through an already-ISO timestamp unchanged', () => {
    const iso = '2026-04-28T00:00:00.000Z';
    const wire = unifiedEventToWire({ type: 'user_message', text: 'hi', timestamp: iso });
    expect(wire).toEqual({ type: 'user_message', text: 'hi', timestamp: iso });
  });

  it('coerces missing text/timestamp to safe defaults', () => {
    const wire = unifiedEventToWire({ type: 'user_message' });
    expect(wire).toEqual({ type: 'user_message', text: '', timestamp: '' });
  });
});

describe('unifiedEventToWire — error codes', () => {
  const codeOf = (error: unknown) =>
    (unifiedEventToWire({ type: 'error', error }) as { code: string }).code;

  it('gives each agent-adapters bound its own code (classes, not subclasses of AdapterTimeoutError)', () => {
    expect(codeOf(new AdapterTimeoutError('claude-code', 1000))).toBe('ADAPTER_TIMEOUT');
    expect(codeOf(new AdapterIdleTimeoutError('claude-code', 1000))).toBe('IDLE_TIMEOUT');
    expect(codeOf(new AdapterToolCallTimeoutError('claude-code', 1000, 'Bash', 'tu-1'))).toBe('TOOL_CALL_TIMEOUT');
    expect(codeOf(new AdapterSubagentTimeoutError('claude-code', 1000, 'task-1'))).toBe('SUBAGENT_TIMEOUT');
    expect(codeOf(new AdapterBackgroundHoldExpiredError('claude-code', 90_000))).toBe('BACKGROUND_HOLD_EXPIRED');
    expect(codeOf(new AdapterAbortError('claude-code'))).toBe('ABORTED');
  });

  it('matches by name on plain (structured-cloned) error objects too', () => {
    expect(codeOf({ name: 'AdapterToolPolicyError', message: 'unenforceable groups' })).toBe('TOOL_POLICY');
    expect(codeOf({ name: 'AdapterIdleTimeoutError', message: 'idle' })).toBe('IDLE_TIMEOUT');
  });

  it('falls back to UNKNOWN for anything else', () => {
    expect(codeOf(new Error('boom'))).toBe('UNKNOWN');
  });
});
