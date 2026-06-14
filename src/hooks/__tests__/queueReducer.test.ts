import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, messageReducer } from '../useMessageReducer.js';
import type { ChatState } from '../../types.js';
import type { QueuedMessage } from '../../server/protocol.js';
import { applyEvents, applyUserMessage, turnStart, FIXED_TS } from './fixtures/eventStreams.js';

const ARCH = 'claude-code';
const MODEL = 'sonnet';
const init = () => createInitialState(ARCH, MODEL);

let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    (() => `uuid-${++uuidCounter}`) as unknown as Crypto['randomUUID'],
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

function q(id: string, text: string): QueuedMessage {
  return { id, text, createdAt: FIXED_TS };
}

describe('messageReducer — queue state', () => {
  it('starts with an empty queue', () => {
    expect(init().queuedMessages).toEqual([]);
  });

  it('queue_updated replaces the queue snapshot', () => {
    let state: ChatState = init();
    state = applyEvents(state, [{ type: 'queue_updated', queued: [q('q1', 'first'), q('q2', 'second')] }]);
    expect(state.queuedMessages).toEqual([q('q1', 'first'), q('q2', 'second')]);

    // A later snapshot fully replaces (cancel removed q1).
    state = applyEvents(state, [{ type: 'queue_updated', queued: [q('q2', 'second')] }]);
    expect(state.queuedMessages).toEqual([q('q2', 'second')]);
  });

  it('queue_cleared empties the queue', () => {
    let state: ChatState = init();
    state = applyEvents(state, [{ type: 'queue_updated', queued: [q('q1', 'x')] }]);
    state = applyEvents(state, [{ type: 'queue_cleared', texts: ['x'] }]);
    expect(state.queuedMessages).toEqual([]);
  });
});

describe('messageReducer — mid-turn user_message injection', () => {
  it('finalizes the active assistant, appends the user message, and re-opens a fresh assistant', () => {
    let state = init();
    state = applyUserMessage(state, 'hi'); // uuid-1 user, uuid-2 assistant
    state = applyEvents(state, [
      turnStart('srv-u1'), // adopts srv-a1 onto the active assistant
      { type: 'text_delta', text: 'working', isSubagent: false },
      // Mid-turn push delivered into the live session:
      { type: 'user_message', text: 'also do X', timestamp: FIXED_TS },
      // The next delta must land in a NEW assistant message:
      { type: 'text_delta', text: 'on it', isSubagent: false },
      { type: 'result', output: 'done', usage: { inputTokens: 1, outputTokens: 2 }, contextSize: 3 },
    ]);

    // user(hi) · assistant(working) · user(also do X) · assistant(on it)
    expect(state.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    const [, firstAssistant, injectedUser, secondAssistant] = state.messages;
    expect(firstAssistant.isStreaming).toBe(false);
    expect(firstAssistant.blocks).toEqual([{ type: 'text', text: 'working', isStreaming: false }]);

    expect(injectedUser.role).toBe('user');
    expect(injectedUser.isStreaming).toBe(false);
    expect(injectedUser.blocks).toEqual([{ type: 'text', text: 'also do X', isStreaming: false }]);
    expect(injectedUser.timestamp).toBe(FIXED_TS);

    // The post-injection delta opened and filled a brand-new assistant message.
    expect(secondAssistant.role).toBe('assistant');
    expect(secondAssistant.blocks).toEqual([{ type: 'text', text: 'on it', isStreaming: false }]);
    expect(secondAssistant.isStreaming).toBe(false); // finalized by result
    expect(state.activeAssistantMessageId).toBeNull();
    expect(state.contextSize).toBe(3);
  });

  it('tolerates more than one result in a stream (push on the turn boundary)', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [
      turnStart('srv-u1'),
      { type: 'text_delta', text: 'a', isSubagent: false },
      { type: 'result', output: 'r1', usage: { inputTokens: 1, outputTokens: 1 }, contextSize: 5 },
      // Boundary push → next-turn-in-session, re-opens assistant via user_message:
      { type: 'user_message', text: 'next', timestamp: FIXED_TS },
      { type: 'text_delta', text: 'b', isSubagent: false },
      { type: 'result', output: 'r2', usage: { inputTokens: 2, outputTokens: 2 }, contextSize: 8 },
    ]);

    expect(state.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // contextSize reflects the LAST result; usage is summed across turns.
    expect(state.contextSize).toBe(8);
    expect(state.usage).toEqual({ inputTokens: 3, outputTokens: 3 });
    expect(state.messages[3].blocks).toEqual([{ type: 'text', text: 'b', isStreaming: false }]);
  });
});

describe('messageReducer — RESTORE hydrates the queue', () => {
  it('resets the queue on thread switch but adopts a provided snapshot', () => {
    let state = init();
    state = applyEvents(state, [{ type: 'queue_updated', queued: [q('q1', 'stale')] }]);
    expect(state.queuedMessages).toHaveLength(1);

    // RESTORE without a snapshot → queue resets (don't leak across threads).
    const restoredEmpty = messageReducer(state, {
      type: 'RESTORE',
      messages: [],
      architecture: ARCH,
      model: MODEL,
    });
    expect(restoredEmpty.queuedMessages).toEqual([]);

    // RESTORE with a snapshot → chips hydrate (F5/resume on a thread with a queue).
    const restoredHydrated = messageReducer(state, {
      type: 'RESTORE',
      messages: [],
      architecture: ARCH,
      model: MODEL,
      queuedMessages: [q('q2', 'pending')],
    });
    expect(restoredHydrated.queuedMessages).toEqual([q('q2', 'pending')]);
  });
});
