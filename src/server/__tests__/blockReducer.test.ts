import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedEvent } from '@inharness-ai/agent-adapters';
import { applyEventToStoredBlocks } from '../blockReducer.js';
import type { StoredContentBlock, WireEvent } from '../protocol.js';
import {
  goldenPathEvents,
  subagentLifecycleEvents,
  thinkingReplaceEvents,
  todoListConsecutiveEvents,
  todoListSeparatedEvents,
} from '../../hooks/__tests__/fixtures/eventStreams.js';

// Server reducer signature is `UnifiedEvent` (1:1 with the previous `collectBlock`
// callsite). The `WireEvent` fixtures from the client tests are structurally
// compatible for the fields the reducer reads, so we cast at the boundary.
function asUnified(events: WireEvent[]): UnifiedEvent[] {
  return events as unknown as UnifiedEvent[];
}

function applyAll(blocks: StoredContentBlock[], events: WireEvent[]): void {
  for (const event of asUnified(events)) {
    applyEventToStoredBlocks(blocks, event);
  }
}

type SubagentBlock = Extract<StoredContentBlock, { type: 'subagent' }>;
type TextBlock = Extract<StoredContentBlock, { type: 'text' }>;
type ThinkingBlock = Extract<StoredContentBlock, { type: 'thinking' }>;
type ToolUseBlock = Extract<StoredContentBlock, { type: 'toolUse' }>;
type ToolResultBlock = Extract<StoredContentBlock, { type: 'toolResult' }>;
type TodoListBlock = Extract<StoredContentBlock, { type: 'todoList' }>;
type UserInputRequestBlock = Extract<StoredContentBlock, { type: 'userInputRequest' }>;

let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    (() => `uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`),
  );
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('applyEventToStoredBlocks — golden path snapshot', () => {
  it('produces stable block list for the golden-path turn fixture', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, goldenPathEvents);
    expect(blocks).toMatchSnapshot();
  });
});

describe('applyEventToStoredBlocks — subagent lifecycle snapshot', () => {
  it('produces stable nested-message tree for the subagent lifecycle fixture', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, subagentLifecycleEvents);
    expect(blocks).toMatchSnapshot();
  });
});

describe('applyEventToStoredBlocks — text_delta', () => {
  it('appends new text block when blocks are empty', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [{ type: 'text_delta', text: 'hi', isSubagent: false }]);
    expect(blocks).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('concatenates into the last text block when present', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'text_delta', text: 'foo ', isSubagent: false },
      { type: 'text_delta', text: 'bar', isSubagent: false },
    ]);
    expect(blocks).toEqual([{ type: 'text', text: 'foo bar' }]);
  });

  it('pushes a new text block when last block is non-text', () => {
    const blocks: StoredContentBlock[] = [
      { type: 'toolUse', toolUseId: 't1', toolName: 'Read', input: {} },
    ];
    applyAll(blocks, [{ type: 'text_delta', text: 'after', isSubagent: false }]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ type: 'text', text: 'after' });
  });

  it('drops subagent text_delta when no active subagent block exists', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'text_delta', text: 'lost', isSubagent: true, subagentTaskId: 'sub-X' },
    ]);
    expect(blocks).toEqual([]);
  });

  it('routes subagent text_delta into the matching subagent block', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'd', toolUseId: 'tu1' },
      { type: 'text_delta', text: 'sub txt', isSubagent: true, subagentTaskId: 'sub-1' },
      { type: 'text_delta', text: ' more', isSubagent: true, subagentTaskId: 'sub-1' },
    ]);
    const sub = blocks[0] as SubagentBlock;
    expect(sub.messages).toHaveLength(1);
    expect(sub.messages[0].blocks).toEqual([{ type: 'text', text: 'sub txt more' }]);
    expect(sub.messages[0].subagentTaskId).toBe('sub-1');
  });

  it('falls back to last running subagent when subagentTaskId is omitted', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'd', toolUseId: 'tu1' },
      { type: 'text_delta', text: 'orphan', isSubagent: true },
    ]);
    const sub = blocks[0] as SubagentBlock;
    expect(sub.messages[0].blocks).toEqual([{ type: 'text', text: 'orphan' }]);
  });
});

describe('applyEventToStoredBlocks — thinking', () => {
  it('replace:false concatenates into last thinking block', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'thinking', text: 'foo', isSubagent: false, replace: false },
      { type: 'thinking', text: 'bar', isSubagent: false, replace: false },
    ]);
    expect(blocks).toEqual([{ type: 'thinking', text: 'foobar' }]);
  });

  it('replace:true forces a new thinking block', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, thinkingReplaceEvents);
    expect(blocks).toEqual([
      { type: 'thinking', text: 'foo' },
      { type: 'thinking', text: 'bar' },
    ]);
  });

  it('replace:true after non-thinking block still pushes new thinking', () => {
    const blocks: StoredContentBlock[] = [{ type: 'text', text: 'hi' }];
    applyAll(blocks, [{ type: 'thinking', text: 'fresh', isSubagent: false, replace: true }]);
    expect(blocks).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'thinking', text: 'fresh' },
    ]);
  });
});

describe('applyEventToStoredBlocks — tool_use / tool_result', () => {
  it('pushes tool_use into root blocks', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'tool_use', toolName: 'Read', toolUseId: 't1', input: { p: '/x' }, isSubagent: false },
    ]);
    expect(blocks).toEqual([{ type: 'toolUse', toolUseId: 't1', toolName: 'Read', input: { p: '/x' } }]);
  });

  it('pushes tool_result into root blocks (no pairing — view-side concern)', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'tool_result', toolUseId: 't1', summary: 'ok', isSubagent: false },
    ]);
    expect(blocks).toEqual([{ type: 'toolResult', toolUseId: 't1', content: 'ok' }]);
  });

  it('drops subagent tool_use when no matching subagent exists (no crash)', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'tool_use', toolName: 'Grep', toolUseId: 't1', input: {}, isSubagent: true, subagentTaskId: 'missing' },
    ]);
    expect(blocks).toEqual([]);
  });

  it('first event in subagent is tool_use → spawns assistant msg with toolUse', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'd', toolUseId: 'tu1' },
      { type: 'tool_use', toolName: 'Grep', toolUseId: 't1', input: { q: 'x' }, isSubagent: true, subagentTaskId: 'sub-1' },
    ]);
    const sub = blocks[0] as SubagentBlock;
    expect(sub.messages).toHaveLength(1);
    expect(sub.messages[0].blocks[0]).toEqual({
      type: 'toolUse', toolUseId: 't1', toolName: 'Grep', input: { q: 'x' },
    });
  });
});

describe('applyEventToStoredBlocks — subagent lifecycle', () => {
  it('subagent_started pushes block with status running and empty messages', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'doing it', toolUseId: 'tu1' },
    ]);
    expect(blocks).toEqual([
      { type: 'subagent', taskId: 'sub-1', toolUseId: 'tu1', description: 'doing it', status: 'running', messages: [] },
    ]);
  });

  it('subagent_started with undefined toolUseId coerces to "" (known quirk)', () => {
    const blocks: StoredContentBlock[] = [];
    // Cast through unknown to bypass the WireEvent type guard — this models
    // the runtime case where an adapter omits toolUseId.
    applyAll(blocks, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'd' } as unknown as WireEvent,
    ]);
    expect((blocks[0] as SubagentBlock).toolUseId).toBe('');
  });

  it('subagent_completed updates status, summary, and usage', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'd', toolUseId: 'tu1' },
      { type: 'subagent_completed', taskId: 'sub-1', status: 'completed', summary: 'done', usage: { inputTokens: 5, outputTokens: 7 } },
    ]);
    const sub = blocks[0] as SubagentBlock;
    expect(sub.status).toBe('completed');
    expect(sub.summary).toBe('done');
    expect(sub.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  it('subagent_completed without prior subagent_started is a no-op', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'subagent_completed', taskId: 'missing', status: 'completed', summary: 'x' },
    ]);
    expect(blocks).toEqual([]);
  });

  it('subagent_completed without usage does not overwrite existing usage', () => {
    const blocks: StoredContentBlock[] = [
      { type: 'subagent', taskId: 'sub-1', toolUseId: 'tu1', description: 'd', status: 'running', messages: [], usage: { inputTokens: 1, outputTokens: 2 } },
    ];
    applyAll(blocks, [
      { type: 'subagent_completed', taskId: 'sub-1', status: 'completed', summary: 'done' },
    ]);
    expect((blocks[0] as SubagentBlock).usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });
});

describe('applyEventToStoredBlocks — todo_list_updated', () => {
  it('two consecutive root events → upserts (replaces items)', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, todoListConsecutiveEvents);
    expect(blocks).toHaveLength(1);
    const todo = blocks[0] as TodoListBlock;
    expect(todo.items).toHaveLength(2);
  });

  it('separated by text_delta → appends new todoList block', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, todoListSeparatedEvents);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('todoList');
    expect(blocks[1].type).toBe('text');
    expect(blocks[2].type).toBe('todoList');
  });

  it('subagent todo_list upserts within nested messages', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'd', toolUseId: 'tu1' },
      { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'pending' }], source: 'model-tool', isSubagent: true, subagentTaskId: 'sub-1' },
      { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'pending' }, { id: '2', content: 'B', status: 'pending' }], source: 'model-tool', isSubagent: true, subagentTaskId: 'sub-1' },
    ]);
    const sub = blocks[0] as SubagentBlock;
    expect(sub.messages).toHaveLength(1);
    expect(sub.messages[0].blocks).toHaveLength(1);
    const todo = sub.messages[0].blocks[0] as TodoListBlock;
    expect(todo.items).toHaveLength(2);
  });
});

describe('applyEventToStoredBlocks — user_input_request', () => {
  it('strips the adapter-specific `native` payload before pushing', () => {
    const blocks: StoredContentBlock[] = [];
    applyAll(blocks, [
      {
        type: 'user_input_request',
        request: {
          requestId: 'req-1',
          source: 'model-tool',
          origin: 'claude-code',
          questions: [{ question: 'OK?', options: [{ label: 'yes' }] }],
          // native is adapter-specific noise that must not be persisted
          native: { internal: 'leak' },
        } as unknown as WireEvent extends { type: 'user_input_request'; request: infer R } ? R : never,
      } as WireEvent,
    ]);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as UserInputRequestBlock;
    expect(block.requestId).toBe('req-1');
    expect((block.request as unknown as Record<string, unknown>).native).toBeUndefined();
    expect(block.request.questions).toEqual([{ question: 'OK?', options: [{ label: 'yes' }] }]);
  });
});

describe('applyEventToStoredBlocks — non-collected event types', () => {
  it.each([
    'connected',
    'turn_start',
    'assistant_message',
    'subagent_progress',
    'user_input_response',
    'result',
    'error',
    'flush',
    'done',
  ] as const)('%s does not mutate blocks', (type) => {
    const blocks: StoredContentBlock[] = [{ type: 'text', text: 'pre' }];
    // Build a minimally-shaped event of the requested type. Cast through
    // unknown — the reducer only reads fields it cares about, others are noise.
    applyEventToStoredBlocks(blocks, { type } as unknown as UnifiedEvent);
    expect(blocks).toEqual([{ type: 'text', text: 'pre' }]);
  });
});

describe('applyEventToStoredBlocks — type signatures', () => {
  it('text/thinking/tool/todo block extractors are narrow', () => {
    // Compile-time smoke test that the extractor types match what the reducer
    // actually produces. If StoredContentBlock evolves and breaks one of these,
    // this test will fail to compile — flagging the regression early.
    const t: TextBlock = { type: 'text', text: 'x' };
    const th: ThinkingBlock = { type: 'thinking', text: 'x' };
    const tu: ToolUseBlock = { type: 'toolUse', toolUseId: 'a', toolName: 'b', input: {} };
    const tr: ToolResultBlock = { type: 'toolResult', toolUseId: 'a', content: 'c' };
    const td: TodoListBlock = { type: 'todoList', items: [] };
    expect([t, th, tu, tr, td].length).toBe(5);
  });
});
