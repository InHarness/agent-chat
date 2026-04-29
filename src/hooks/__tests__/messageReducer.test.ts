import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInitialState,
  messageReducer,
} from '../useMessageReducer.js';
import type { ChatMessage, ChatState, UIContentBlock } from '../../types.js';
import {
  applyEvents,
  applyUserMessage,
  errorMidStreamEvents,
  FIXED_TS,
  freshJoinF5Events,
  goldenPathEvents,
  makeUserInputRequest,
  subagentLifecycleEvents,
  thinkingReplaceEvents,
  todoListConsecutiveEvents,
  todoListSeparatedEvents,
  turnStart,
} from './fixtures/eventStreams.js';

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

type SubagentBlock = Extract<UIContentBlock, { type: 'subagent' }>;
type TextBlock = Extract<UIContentBlock, { type: 'text' }>;
type ThinkingBlock = Extract<UIContentBlock, { type: 'thinking' }>;
type ToolUseBlock = Extract<UIContentBlock, { type: 'toolUse' }>;
type ToolResultBlock = Extract<UIContentBlock, { type: 'toolResult' }>;
type TodoListBlock = Extract<UIContentBlock, { type: 'todoList' }>;
type UserInputRequestBlock = Extract<UIContentBlock, { type: 'userInputRequest' }>;

describe('messageReducer — golden path turn', () => {
  it('processes USER_MESSAGE → turn_start → text deltas → tool_use → tool_result → result', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    expect(state.messages).toHaveLength(2);
    expect(state.activeAssistantMessageId).toBe('uuid-2');

    state = applyEvents(state, goldenPathEvents);

    expect(state.activeAssistantMessageId).toBeNull();
    expect(state.isStreaming).toBe(false);
    expect(state.usage).toEqual({ inputTokens: 10, outputTokens: 20 });

    const assistant = state.messages.find(m => m.role === 'assistant')!;
    expect(assistant.id).toBe('srv-a1');
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.usage).toEqual({ inputTokens: 10, outputTokens: 20 });

    expect(assistant.blocks).toHaveLength(3);
    expect(assistant.blocks[0]).toEqual({ type: 'text', text: 'Hello world!', isStreaming: false });
    expect(assistant.blocks[1]).toMatchObject({ type: 'toolUse', toolUseId: 't1', toolName: 'Read', collapsed: true });
    expect(assistant.blocks[2]).toMatchObject({ type: 'toolResult', toolUseId: 't1', content: 'ok', isError: false, collapsed: true });
  });
});

describe('messageReducer — turn_start after optimistic USER_MESSAGE', () => {
  it('adopts server-side IDs without duplicating the optimistic user+assistant pair', () => {
    let state = init();
    state = applyUserMessage(state, 'hello');
    // Optimistic state: 2 messages with client UUIDs, activeAssistantMessageId = 'uuid-2'.
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].id).toBe('uuid-1');
    expect(state.messages[1].id).toBe('uuid-2');

    state = applyEvents(state, [
      { type: 'turn_start', userMessageId: 'srv-u-X', assistantMessageId: 'srv-a-X', prompt: 'hello', timestamp: FIXED_TS },
    ]);

    // Bug-before-fix: would have appended a second pair → length 4.
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].id).toBe('srv-u-X');
    expect(state.messages[1].id).toBe('srv-a-X');
    expect(state.activeAssistantMessageId).toBe('srv-a-X');
    expect(state.isStreaming).toBe(true);
    // User message content survived the ID swap.
    expect(state.messages[0].blocks[0]).toEqual({ type: 'text', text: 'hello', isStreaming: false });
  });
});

describe('messageReducer — fresh F5 join', () => {
  it('synthesizes user + assistant messages when turn_start arrives without preceding USER_MESSAGE', () => {
    const state = applyEvents(init(), freshJoinF5Events);

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ id: 'srv-u1', role: 'user', isStreaming: false });
    expect(state.messages[0].blocks[0]).toEqual({ type: 'text', text: 'restored prompt', isStreaming: false });
    expect(state.messages[1]).toMatchObject({ id: 'srv-a1', role: 'assistant', isStreaming: true });
    expect(state.messages[1].blocks).toEqual([]);
    expect(state.activeAssistantMessageId).toBe('srv-a1');
    expect(state.isStreaming).toBe(true);
  });

  it('is a no-op when the same turn_start replays for an already-active stream', () => {
    let state = applyEvents(init(), freshJoinF5Events);
    const before = state;
    state = applyEvents(state, freshJoinF5Events);
    expect(state).toBe(before);
  });
});

describe('messageReducer — text_delta isSubagent: true', () => {
  function withRunningSubagent(taskId = 'sub-1'): ChatState {
    let state = init();
    state = applyUserMessage(state, 'hi');
    return applyEvents(state, [
      turnStart('srv-u1'),
      { type: 'subagent_started', taskId, description: 'work', toolUseId: 'tu-x' },
    ]);
  }

  function getSubBlock(state: ChatState): SubagentBlock {
    const assistant = state.messages.find(m => m.role === 'assistant')!;
    return assistant.blocks.find(b => b.type === 'subagent') as SubagentBlock;
  }

  it('routes text into the subagent identified by subagentTaskId', () => {
    let state = withRunningSubagent('sub-1');
    state = applyEvents(state, [
      { type: 'text_delta', text: 'A ', isSubagent: true, subagentTaskId: 'sub-1' },
      { type: 'text_delta', text: 'B', isSubagent: true, subagentTaskId: 'sub-1' },
    ]);
    const sub = getSubBlock(state);
    expect(sub.messages).toHaveLength(1);
    expect(sub.messages[0].blocks).toHaveLength(1);
    expect(sub.messages[0].blocks[0]).toEqual({ type: 'text', text: 'A B', isStreaming: true });
    // Top-level assistant should NOT have a text block — text went to subagent.
    const assistant = state.messages.find(m => m.role === 'assistant')!;
    expect(assistant.blocks.some(b => b.type === 'text')).toBe(false);
  });

  it('falls back to the only running subagent when subagentTaskId is missing', () => {
    let state = withRunningSubagent('sub-1');
    state = applyEvents(state, [
      { type: 'text_delta', text: 'fallback', isSubagent: true },
    ]);
    const sub = getSubBlock(state);
    expect(sub.messages[0].blocks[0]).toMatchObject({ type: 'text', text: 'fallback', isStreaming: true });
  });

  it('is a no-op when there is no active subagent', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [turnStart('srv-u1')]);

    const before = state;
    const after = applyEvents(state, [
      { type: 'text_delta', text: 'orphan', isSubagent: true, subagentTaskId: 'nope' },
    ]);
    expect(after).toBe(before);
  });
});

describe('messageReducer — thinking replace: true', () => {
  it('finalizes the previous thinking block and appends a new streaming one', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [turnStart('srv-u1'), ...thinkingReplaceEvents]);

    const assistant = state.messages.find(m => m.role === 'assistant')!;
    const thinkingBlocks = assistant.blocks.filter(b => b.type === 'thinking') as ThinkingBlock[];
    expect(thinkingBlocks).toHaveLength(2);
    expect(thinkingBlocks[0]).toMatchObject({ text: 'foo', isStreaming: false });
    expect(thinkingBlocks[1]).toMatchObject({ text: 'bar', isStreaming: true });
  });

  it('without replace, consecutive thinking deltas concatenate', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [
      turnStart('srv-u1'),
      { type: 'thinking', text: 'one ', isSubagent: false },
      { type: 'thinking', text: 'two', isSubagent: false },
    ]);
    const assistant = state.messages.find(m => m.role === 'assistant')!;
    const blocks = assistant.blocks.filter(b => b.type === 'thinking') as ThinkingBlock[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ text: 'one two', isStreaming: true });
  });
});

describe('messageReducer — todo_list_updated', () => {
  function freshTurn(): ChatState {
    let state = init();
    state = applyUserMessage(state, 'hi');
    return applyEvents(state, [turnStart('srv-u1')]);
  }

  it('replaces the last todoList block when two updates arrive consecutively', () => {
    const state = applyEvents(freshTurn(), todoListConsecutiveEvents);
    const assistant = state.messages.find(m => m.role === 'assistant')!;
    const todoBlocks = assistant.blocks.filter(b => b.type === 'todoList') as TodoListBlock[];
    expect(todoBlocks).toHaveLength(1);
    expect(todoBlocks[0].items).toHaveLength(2);
    expect(state.currentTodoItems).toEqual([
      { id: '1', content: 'A', status: 'pending' },
      { id: '2', content: 'B', status: 'pending' },
    ]);
  });

  it('appends a new todoList block when separated by other content', () => {
    const state = applyEvents(freshTurn(), todoListSeparatedEvents);
    const assistant = state.messages.find(m => m.role === 'assistant')!;
    const todoBlocks = assistant.blocks.filter(b => b.type === 'todoList') as TodoListBlock[];
    expect(todoBlocks).toHaveLength(2);
    // Streaming text between the two todoLists should have been finalized on the second todoList.
    const textBlock = assistant.blocks.find(b => b.type === 'text') as TextBlock;
    expect(textBlock.isStreaming).toBe(false);
  });

  it('upserts inside subagent and updates currentTodoItems', () => {
    let state = freshTurn();
    state = applyEvents(state, [
      { type: 'subagent_started', taskId: 'sub-1', description: 'work', toolUseId: 'tu-x' },
      { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'pending' }], source: 'model-tool', isSubagent: true, subagentTaskId: 'sub-1' },
      { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'in_progress' }], source: 'model-tool', isSubagent: true, subagentTaskId: 'sub-1' },
    ]);
    const sub = (state.messages.find(m => m.role === 'assistant')!.blocks.find(b => b.type === 'subagent')) as SubagentBlock;
    const subTodoBlocks = sub.messages.flatMap(m => m.blocks).filter(b => b.type === 'todoList') as TodoListBlock[];
    expect(subTodoBlocks).toHaveLength(1);
    expect(subTodoBlocks[0].items).toEqual([{ id: '1', content: 'A', status: 'in_progress' }]);
    expect(state.currentTodoItems).toEqual([{ id: '1', content: 'A', status: 'in_progress' }]);
  });
});

describe('messageReducer — subagent lifecycle', () => {
  it('runs the full lifecycle and ignores events for the same taskId after completion', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [turnStart('srv-u1'), ...subagentLifecycleEvents]);

    expect(state.activeSubagents.has('sub-1')).toBe(false);

    const assistant = state.messages.find(m => m.role === 'assistant')!;
    const sub = assistant.blocks.find(b => b.type === 'subagent') as SubagentBlock;
    expect(sub.status).toBe('completed');
    expect(sub.summary).toBe('sub done');
    expect(sub.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
    expect(sub.description).toBe('still doing it');

    expect(sub.messages).toHaveLength(1);
    const subBlocks = sub.messages[0].blocks;
    const subText = subBlocks.find(b => b.type === 'text') as TextBlock;
    const subToolUse = subBlocks.find(b => b.type === 'toolUse') as ToolUseBlock;
    const subToolResult = subBlocks.find(b => b.type === 'toolResult') as ToolResultBlock;
    expect(subText).toMatchObject({ text: 'sub thought' });
    expect(subToolUse).toMatchObject({ toolUseId: 't-sub-1', toolName: 'Grep' });
    expect(subToolResult).toMatchObject({ toolUseId: 't-sub-1', content: 'sub ok' });
    // tool_use should have finalized the streaming sub-text.
    expect(subText.isStreaming).toBe(false);

    // Top-level assistant must not own these sub blocks.
    expect(assistant.blocks.some(b => b.type === 'text' || b.type === 'toolUse' || b.type === 'toolResult')).toBe(false);

    // Late event for the completed taskId is a no-op.
    const before = state;
    const after = applyEvents(state, [
      { type: 'text_delta', text: 'late', isSubagent: true, subagentTaskId: 'sub-1' },
    ]);
    expect(after).toBe(before);
  });

  it('subagent_progress for an unknown taskId is a no-op', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [turnStart('srv-u1')]);
    const before = state;
    const after = applyEvents(state, [
      { type: 'subagent_progress', taskId: 'never-started', description: 'x' },
    ]);
    expect(after).toBe(before);
  });
});

describe('messageReducer — user_input recursion', () => {
  it('updates a top-level userInputRequest block when matching response arrives', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [
      turnStart('srv-u1'),
      { type: 'user_input_request', request: makeUserInputRequest('req-1') },
      { type: 'user_input_response', requestId: 'req-1', response: { action: 'accept', answers: [['yes']] } },
    ]);
    const assistant = state.messages.find(m => m.role === 'assistant')!;
    const reqBlock = assistant.blocks.find(b => b.type === 'userInputRequest') as UserInputRequestBlock;
    expect(reqBlock.response).toEqual({ action: 'accept', answers: [['yes']] });
  });

  it('descends into subagent.messages to update a nested userInputRequest (RESTORE seeded)', () => {
    const restored: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        blocks: [{ type: 'text', text: 'go', isStreaming: false }],
        timestamp: FIXED_TS,
        isStreaming: false,
      },
      {
        id: 'a1',
        role: 'assistant',
        blocks: [
          {
            type: 'subagent',
            taskId: 'sub-1',
            toolUseId: 'tu-sub1',
            description: 'work',
            status: 'running',
            messages: [
              {
                id: 'sub-m1',
                role: 'assistant',
                blocks: [
                  { type: 'userInputRequest', requestId: 'req-deep', request: makeUserInputRequest('req-deep') },
                ],
                timestamp: FIXED_TS,
                isStreaming: true,
              },
            ],
          },
        ],
        timestamp: FIXED_TS,
        isStreaming: false,
      },
    ];

    let state = init();
    state = messageReducer(state, { type: 'RESTORE', messages: restored, architecture: ARCH, model: MODEL });
    state = applyEvents(state, [
      { type: 'user_input_response', requestId: 'req-deep', response: { action: 'decline' } },
    ]);

    const sub = state.messages[1].blocks[0] as SubagentBlock;
    const nested = sub.messages[0].blocks[0] as UserInputRequestBlock;
    expect(nested.response).toEqual({ action: 'decline' });
  });

  it('is structurally idempotent for an unknown requestId', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, [
      turnStart('srv-u1'),
      { type: 'user_input_request', request: makeUserInputRequest('req-1') },
    ]);
    const before = state;
    const after = applyEvents(state, [
      { type: 'user_input_response', requestId: 'unknown', response: { action: 'cancel' } },
    ]);
    expect(after.messages).toEqual(before.messages);
  });
});

describe('messageReducer — error mid-stream', () => {
  it('finalizes the active assistant message, sets error, stops streaming', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    state = applyEvents(state, errorMidStreamEvents);

    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe('kaboom');
    expect(state.isStreaming).toBe(false);
    expect(state.activeAssistantMessageId).toBeNull();

    const assistant = state.messages.find(m => m.role === 'assistant')!;
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.blocks[0]).toMatchObject({ type: 'text', text: 'partial', isStreaming: false });
  });
});

// --- Coverage extras: cheap branches not in the 8 mandatory scenarios. ---

describe('messageReducer — RESTORE / SET_ARCHITECTURE / SET_MODEL / CLEAR', () => {
  it('RESTORE replaces messages and recovers latest todoList + assistant usage', () => {
    const restored: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        blocks: [{ type: 'text', text: 'q', isStreaming: false }],
        timestamp: FIXED_TS,
        isStreaming: false,
      },
      {
        id: 'a1',
        role: 'assistant',
        blocks: [{ type: 'todoList', items: [{ id: '1', content: 'X', status: 'pending' }] }],
        timestamp: FIXED_TS,
        isStreaming: false,
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    ];
    const state = messageReducer(init(), {
      type: 'RESTORE',
      messages: restored,
      sessionId: 'sess',
      architecture: 'claude-code',
      model: 'haiku',
    });
    expect(state.messages).toBe(restored);
    expect(state.sessionId).toBe('sess');
    expect(state.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
    expect(state.currentTodoItems).toEqual([{ id: '1', content: 'X', status: 'pending' }]);
    expect(state.activeSubagents.size).toBe(0);
    expect(state.isStreaming).toBe(false);
  });

  it('RESTORE finds todoList nested in subagent.messages', () => {
    const restored: ChatMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        blocks: [
          {
            type: 'subagent',
            taskId: 's',
            toolUseId: 'tu',
            description: 'd',
            status: 'completed',
            messages: [
              {
                id: 'sm',
                role: 'assistant',
                blocks: [{ type: 'todoList', items: [{ id: 'n', content: 'nested', status: 'pending' }] }],
                timestamp: FIXED_TS,
                isStreaming: false,
              },
            ],
          },
        ],
        timestamp: FIXED_TS,
        isStreaming: false,
      },
    ];
    const state = messageReducer(init(), { type: 'RESTORE', messages: restored, architecture: ARCH, model: MODEL });
    expect(state.currentTodoItems).toEqual([{ id: 'n', content: 'nested', status: 'pending' }]);
  });

  it('SET_ARCHITECTURE patches architecture and preserves messages, sessionId, usage', () => {
    let state = applyUserMessage(init(), 'hi');
    state = applyEvents(state, goldenPathEvents);
    const before = {
      messages: state.messages,
      sessionId: state.sessionId,
      usage: state.usage,
    };
    state = messageReducer(state, { type: 'SET_ARCHITECTURE', architecture: 'codex' });
    expect(state.architecture).toBe('codex');
    expect(state.model).toBe(MODEL);
    // Conversation context survives the rollover — server replays it on the next turn.
    expect(state.messages).toBe(before.messages);
    expect(state.sessionId).toBe(before.sessionId);
    expect(state.usage).toEqual(before.usage);
  });

  it('SET_MODEL patches model and preserves messages, sessionId, usage', () => {
    let state = applyUserMessage(init(), 'hi');
    state = applyEvents(state, goldenPathEvents);
    const before = {
      messages: state.messages,
      sessionId: state.sessionId,
      usage: state.usage,
    };
    state = messageReducer(state, { type: 'SET_MODEL', model: 'opus' });
    expect(state.model).toBe('opus');
    expect(state.architecture).toBe(ARCH);
    expect(state.messages).toBe(before.messages);
    expect(state.sessionId).toBe(before.sessionId);
    expect(state.usage).toEqual(before.usage);
  });

  it('CLEAR resets state to initial', () => {
    let state = applyUserMessage(init(), 'hi');
    state = messageReducer(state, { type: 'CLEAR' });
    expect(state).toEqual(createInitialState(ARCH, MODEL));
  });
});

describe('messageReducer — misc no-op events', () => {
  it('connected, flush, done, assistant_message are pure no-ops', () => {
    let state = init();
    state = applyUserMessage(state, 'hi');
    const before = state;
    const after = applyEvents(state, [
      { type: 'connected', requestId: 'r1' },
      { type: 'flush' },
      { type: 'done' },
      { type: 'assistant_message', message: { role: 'assistant', content: [], timestamp: FIXED_TS } },
    ]);
    expect(after).toBe(before);
  });
});
