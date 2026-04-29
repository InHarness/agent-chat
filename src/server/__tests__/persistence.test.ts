import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThreadStore } from '../thread-store.js';
import { persistTurn } from '../persistence.js';
import type { StoredMessage, StoredThread } from '../protocol.js';

let dir: string;
let threads: ThreadStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-chat-persistence-'));
  threads = new ThreadStore(dir, { warn: () => {} });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('persistTurn', () => {
  it('stamps architecture/model on the user and assistant messages', () => {
    threads.create('t1', 'test', 'claude-code', 'opus');
    const userMsg: StoredMessage = {
      id: 'u1',
      role: 'user',
      blocks: [{ type: 'text', text: 'hi' }],
      timestamp: '2026-04-28T00:00:00.000Z',
    };
    persistTurn({
      threads,
      threadId: 't1',
      userMessage: userMsg,
      assistantMessageId: 'a1',
      assistantBlocks: [{ type: 'text', text: 'hello' }],
      resultUsage: { inputTokens: 1, outputTokens: 2 },
      resultSessionId: 'sess-fresh',
      architecture: 'claude-code',
      model: 'opus',
    });

    const stored = threads.get('t1')!;
    expect(stored.messages).toHaveLength(2);
    const [u, a] = stored.messages;
    expect(u).toMatchObject({ id: 'u1', architecture: 'claude-code', model: 'opus' });
    expect(a).toMatchObject({ id: 'a1', architecture: 'claude-code', model: 'opus', usage: { inputTokens: 1, outputTokens: 2 } });
    expect(stored.sessionId).toBe('sess-fresh');
  });

  it('records turns under the architecture they were authored with even after rollover', () => {
    // Turn 1 under claude-code/opus
    threads.create('t1', 'test', 'claude-code', 'opus');
    persistTurn({
      threads,
      threadId: 't1',
      userMessage: { id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'q1' }], timestamp: '2026-04-28T00:00:00.000Z' },
      assistantMessageId: 'a1',
      assistantBlocks: [{ type: 'text', text: 'r1' }],
      resultUsage: undefined,
      resultSessionId: 'sess-1',
      architecture: 'claude-code',
      model: 'opus',
    });

    // Architecture rollover (handler-side responsibility — emulated here).
    threads.update('t1', { architecture: 'gemini', model: 'gemini-flash', sessionId: undefined });

    // Turn 2 under gemini/gemini-flash
    persistTurn({
      threads,
      threadId: 't1',
      userMessage: { id: 'u2', role: 'user', blocks: [{ type: 'text', text: 'q2' }], timestamp: '2026-04-28T00:00:01.000Z' },
      assistantMessageId: 'a2',
      assistantBlocks: [{ type: 'text', text: 'r2' }],
      resultUsage: undefined,
      resultSessionId: 'sess-2',
      architecture: 'gemini',
      model: 'gemini-flash',
    });

    const stored: StoredThread = threads.get('t1')!;
    expect(stored.messages.map(m => `${m.architecture}/${m.model}`)).toEqual([
      'claude-code/opus',
      'claude-code/opus',
      'gemini/gemini-flash',
      'gemini/gemini-flash',
    ]);
    expect(stored.architecture).toBe('gemini');
    expect(stored.model).toBe('gemini-flash');
    expect(stored.sessionId).toBe('sess-2');
  });
});

describe('ThreadStore.update — sessionId clearing', () => {
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
