// Contract: `result` closes a BLOCK, a further `turn_start` closes a TURN,
// `done` and `error` close the STREAM. One test per acceptance criterion
// tagged `multi-result` in the specification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, messageReducer } from '../useMessageReducer.js';
import type { ChatState, UIContentBlock } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import {
  applyEvents,
  applyUserMessage,
  FIXED_TS,
  multiResultTurnEvents,
  turnStart,
} from './fixtures/eventStreams.js';

const init = () => createInitialState('claude-code', 'sonnet');

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

type TextBlock = Extract<UIContentBlock, { type: 'text' }>;

/** Everything in `multiResultTurnEvents` up to (not including) `done`. */
const untilDone = multiResultTurnEvents.slice(0, -1);
/** Everything up to and including the FIRST `result`. */
const untilFirstResult = multiResultTurnEvents.slice(
  0,
  multiResultTurnEvents.findIndex(e => e.type === 'result') + 1,
);

function started(): ChatState {
  return applyUserMessage(init(), 'hi');
}

function assistantText(state: ChatState, id: string): string {
  const msg = state.messages.find(m => m.id === id)!;
  return msg.blocks.filter((b): b is TextBlock => b.type === 'text').map(b => b.text).join('');
}

describe('result closes a block, not the turn', () => {
  it('accepts more than one result frame in a single turn', () => {
    const state = applyEvents(started(), multiResultTurnEvents);
    // One user/assistant pair — both blocks landed in the same turn.
    expect(state.messages.map(m => m.role)).toEqual(['user', 'assistant']);
  });

  it('adds content arriving after a result to the assistant message active before it', () => {
    const state = applyEvents(started(), multiResultTurnEvents);
    expect(assistantText(state, 'srv-a1')).toBe('Starting a subagent. Subagent finished.');
  });

  it('keeps isStreaming true after a result', () => {
    const state = applyEvents(started(), untilFirstResult);
    expect(state.isStreaming).toBe(true);
    expect(state.activeAssistantMessageId).toBe('srv-a1');
  });

  it('keeps activeSubagents across a result', () => {
    const state = applyEvents(started(), untilFirstResult);
    expect(state.activeSubagents.has('sub-1')).toBe(true);
  });

  it('grows the hook usage by each result usage', () => {
    let state = applyEvents(started(), untilFirstResult);
    expect(state.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    state = applyEvents(state, multiResultTurnEvents.slice(untilFirstResult.length));
    expect(state.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
  });

  it('sums the usage of the result frames an assistant message received', () => {
    const state = applyEvents(started(), multiResultTurnEvents);
    const assistant = state.messages.find(m => m.id === 'srv-a1')!;
    expect(assistant.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
  });

  it('takes contextSize from the last result frame', () => {
    const state = applyEvents(started(), multiResultTurnEvents);
    expect(state.contextSize).toBe(27);
    expect(state.messages.find(m => m.id === 'srv-a1')!.contextSize).toBe(27);
  });

  it('closes the open text block on result while the message keeps streaming', () => {
    const state = applyEvents(started(), untilFirstResult);
    const msg = state.messages.find(m => m.id === 'srv-a1')!;
    expect(msg.isStreaming).toBe(true);
    expect(msg.blocks.every(b => b.type !== 'text' || !b.isStreaming)).toBe(true);
  });
});

describe('done and error close the stream', () => {
  it('sets isStreaming to false on done', () => {
    const state = applyEvents(started(), multiResultTurnEvents);
    expect(state.isStreaming).toBe(false);
    expect(state.activeAssistantMessageId).toBeNull();
    expect(state.messages.find(m => m.id === 'srv-a1')!.isStreaming).toBe(false);
  });

  it('sets isStreaming to false on error', () => {
    const state = applyEvents(started(), [
      ...untilFirstResult,
      { type: 'error', error: 'kaboom', code: 'E_BAD' },
    ]);
    expect(state.isStreaming).toBe(false);
  });

  it('empties activeSubagents on done', () => {
    const before = applyEvents(started(), untilDone);
    expect(before.activeSubagents.size).toBe(1);
    const after = applyEvents(before, [{ type: 'done' }]);
    expect(after.activeSubagents.size).toBe(0);
  });

  it('leaves the reducer state unchanged on a done after an error', () => {
    const errored = applyEvents(started(), [
      ...untilFirstResult,
      { type: 'error', error: 'kaboom', code: 'E_BAD' },
    ]);
    const after = messageReducer(errored, { type: 'EVENT', event: { type: 'done' } });
    expect(after).toBe(errored);
  });

  it('a second done is a no-op', () => {
    const doneOnce = applyEvents(started(), multiResultTurnEvents);
    expect(messageReducer(doneOnce, { type: 'EVENT', event: { type: 'done' } })).toBe(doneOnce);
  });

  it('a second error only updates the reported error', () => {
    const errored = applyEvents(started(), [
      turnStart('srv-u1'),
      { type: 'error', error: 'first', code: 'E1' },
    ]);
    const again = applyEvents(errored, [{ type: 'error', error: 'second', code: 'E2' }]);
    expect(again.error?.message).toBe('second');
    expect(again.messages).toBe(errored.messages);
    expect(again.isStreaming).toBe(false);
  });

  it('drops result, subagent and todo frames that arrive after done — state unchanged', () => {
    const doneState = applyEvents(started(), multiResultTurnEvents);
    const after = applyEvents(doneState, [
      { type: 'result', output: 'late', usage: { inputTokens: 9, outputTokens: 9 }, contextSize: 99, sessionId: 'late' },
      { type: 'subagent_started', taskId: 'late-sub', description: 'late', toolUseId: 'tu-late' },
      { type: 'todo_list_updated', items: [], source: 'model-tool', isSubagent: false },
    ]);
    expect(after).toBe(doneState);
  });

  it('holds, at done, a usage equal to the sum over its assistant messages', () => {
    const state = applyEvents(started(), multiResultTurnEvents);
    const summed = state.messages
      .filter(m => m.role === 'assistant' && m.usage)
      .reduce((acc, m) => ({
        inputTokens: acc.inputTokens + m.usage!.inputTokens,
        outputTokens: acc.outputTokens + m.usage!.outputTokens,
      }), { inputTokens: 0, outputTokens: 0 });
    expect(state.usage).toEqual(summed);
  });

  it('keeps the stream armed on a failed side request (QUEUE_ERROR / USER_INPUT_ERROR)', () => {
    let state = applyEvents(started(), untilFirstResult);
    const activeId = state.activeAssistantMessageId;
    state = applyEvents(state, [{ type: 'error', error: 'Queue is full', code: 'QUEUE_ERROR' }]);
    expect(state.error?.message).toBe('Queue is full');
    expect(state.isStreaming).toBe(true);
    expect(state.activeAssistantMessageId).toBe(activeId);
    expect(state.activeSubagents.size).toBe(1);

    state = applyEvents(state, multiResultTurnEvents.slice(untilFirstResult.length));
    expect(assistantText(state, activeId!)).toContain('Subagent finished.');
    expect(state.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
    expect(state.isStreaming).toBe(false);
  });

  it('ignores a replayed turn the thread already holds (reload inside the grace window)', () => {
    const live = applyEvents(started(), multiResultTurnEvents);
    const restored = messageReducer(init(), {
      type: 'RESTORE',
      messages: live.messages,
      architecture: 'claude-code',
      model: 'sonnet',
    });
    const replayed = applyEvents(restored, multiResultTurnEvents);
    expect(replayed.messages).toBe(restored.messages);
    expect(replayed.usage).toEqual(restored.usage);
    expect(replayed.isStreaming).toBe(false);
  });

  it('drops content frames that arrive after done', () => {
    const doneState = applyEvents(started(), multiResultTurnEvents);
    const after = applyEvents(doneState, [{ type: 'text_delta', text: 'late', isSubagent: false }]);
    expect(after.messages).toBe(doneState.messages);
  });
});

describe('a stream may carry several turns', () => {
  const secondTurn: WireEvent[] = [
    turnStart('srv-u2', 'srv-a2', 'queued'),
    { type: 'text_delta', text: 'second turn', isSubagent: false },
    { type: 'result', output: 'second turn', usage: { inputTokens: 3, outputTokens: 4 }, contextSize: 40 },
    { type: 'done' },
  ];

  it('accepts more than one turn_start on one stream', () => {
    const state = applyEvents(started(), [...untilDone, ...secondTurn]);
    expect(state.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(state.messages[3].id).toBe('srv-a2');
    expect(assistantText(state, 'srv-a2')).toBe('second turn');
  });

  it('leaves the ids of the previous user and assistant messages unchanged on a second turn_start', () => {
    const state = applyEvents(started(), [...untilDone, ...secondTurn]);
    expect(state.messages[0].id).toBe('srv-u1');
    expect(state.messages[1].id).toBe('srv-a1');
    expect(assistantText(state, 'srv-a1')).toBe('Starting a subagent. Subagent finished.');
  });

  it('finalizes the previous pair and clears activeSubagents on a further turn_start', () => {
    const state = applyEvents(started(), [...untilDone, secondTurn[0]]);
    expect(state.messages[1].isStreaming).toBe(false);
    expect(state.activeSubagents.size).toBe(0);
    expect(state.isStreaming).toBe(true);
    expect(state.activeAssistantMessageId).toBe('srv-a2');
  });

  it('adopts the server ids onto the optimistic pair only on the first turn_start', () => {
    const state = applyEvents(started(), [turnStart('srv-u1')]);
    expect(state.messages.map(m => m.id)).toEqual(['srv-u1', 'srv-a1']);
    expect(state.optimisticAssistantMessageId).toBeNull();
  });

  it('a fresh join (no optimistic pair) appends the pair from turn_start', () => {
    const state = applyEvents(init(), [
      { type: 'turn_start', userMessageId: 'srv-u9', assistantMessageId: 'srv-a9', prompt: 'p', timestamp: FIXED_TS },
    ]);
    expect(state.messages.map(m => m.id)).toEqual(['srv-u9', 'srv-a9']);
  });
});
