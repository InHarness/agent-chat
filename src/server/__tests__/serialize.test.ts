import { describe, expect, it } from 'vitest';
import { unifiedEventToWire } from '../serialize.js';

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
