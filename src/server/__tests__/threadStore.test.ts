import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThreadStore } from '../thread-store.js';
import type { StoredMessage } from '../protocol.js';

let dir: string;
let threads: ThreadStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-chat-threadstore-'));
  threads = new ThreadStore(dir, { warn: () => {} });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const message = (id: string, role: 'user' | 'assistant'): StoredMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text: id }],
  timestamp: '2026-04-28T00:00:00.000Z',
});

describe('ThreadStore.update — sessionId clearing', () => {
  // The chat handler relies on this to drop a stale sessionId (history-replay
  // rollover, resume-failure fallback).
  it('explicitly clearing sessionId removes it from the persisted JSON', () => {
    threads.create('t1', 'test', 'claude-code', 'opus');
    threads.update('t1', { sessionId: 'sess-stale' });
    // Explicit `sessionId: undefined` should drop the field on disk.
    threads.update('t1', { sessionId: undefined });

    const raw = readFileSync(join(dir, 't1.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.sessionId).toBeUndefined();
    expect('sessionId' in parsed).toBe(false);
  });
});

describe('ThreadStore.appendMessages — once per stream', () => {
  it('appends every message of the stream and overwrites sessionId', () => {
    threads.create('t1', 'test', 'claude-code', 'opus');
    threads.appendMessages('t1', [message('u1', 'user'), message('a1', 'assistant')], 'sess-1');
    threads.appendMessages(
      't1',
      [message('u2', 'user'), message('a2', 'assistant'), message('u3', 'user'), message('a3', 'assistant')],
      'sess-2',
    );

    const stored = threads.get('t1')!;
    expect(stored.messages.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    expect(stored.sessionId).toBe('sess-2');
  });

  it('keeps the recorded sessionId when the stream produced none', () => {
    threads.create('t1', 'test', 'claude-code', 'opus');
    threads.appendMessages('t1', [message('u1', 'user'), message('a1', 'assistant')], 'sess-1');
    threads.appendMessages('t1', [message('u2', 'user'), message('a2', 'assistant')], undefined);
    expect(threads.get('t1')!.sessionId).toBe('sess-1');
  });
});
