// Reusable WireEvent fixtures + reducer helpers for messageReducer tests.
// `crypto.randomUUID` is stubbed so that USER_MESSAGE produces deterministic
// client-side IDs `uuid-1` (user) and `uuid-2` (assistant). Fixtures use
// server-side IDs (`srv-u*`, `srv-a*`) for `turn_start` to mirror production:
// client and server pick UUIDs independently, they never coincide. Tests must
// rely on `activeAssistantMessageId`, not on cross-side ID equality.

import type { WireEvent, UserInputRequest } from '../../../server/protocol.js';
import type { ChatState } from '../../../types.js';
import { messageReducer } from '../../useMessageReducer.js';

export function applyEvents(state: ChatState, events: WireEvent[]): ChatState {
  return events.reduce<ChatState>(
    (s, event) => messageReducer(s, { type: 'EVENT', event }),
    state,
  );
}

export function applyUserMessage(state: ChatState, text: string): ChatState {
  return messageReducer(state, { type: 'USER_MESSAGE', text });
}

export const FIXED_TS = '2026-04-28T00:00:00.000Z';

export function turnStart(
  userMessageId: string,
  assistantMessageId = 'srv-a1',
  prompt = 'hi',
): WireEvent {
  return { type: 'turn_start', userMessageId, assistantMessageId, prompt, timestamp: FIXED_TS };
}

// Golden path turn. Server picks its own UUIDs that don't match client's optimistic ones.
export const goldenPathEvents: WireEvent[] = [
  turnStart('srv-u1'),
  { type: 'text_delta', text: 'Hello ', isSubagent: false },
  { type: 'text_delta', text: 'world', isSubagent: false },
  { type: 'text_delta', text: '!', isSubagent: false },
  { type: 'tool_use', toolName: 'Read', toolUseId: 't1', input: { path: '/x' }, isSubagent: false },
  { type: 'tool_result', toolUseId: 't1', summary: 'ok', isSubagent: false },
  { type: 'result', output: 'done', usage: { inputTokens: 10, outputTokens: 20 } },
];

// Fresh F5 join: turn_start with no preceding USER_MESSAGE.
export const freshJoinF5Events: WireEvent[] = [
  { type: 'turn_start', userMessageId: 'srv-u1', assistantMessageId: 'srv-a1', prompt: 'restored prompt', timestamp: FIXED_TS },
];

// thinking with replace:false then replace:true.
export const thinkingReplaceEvents: WireEvent[] = [
  { type: 'thinking', text: 'foo', isSubagent: false, replace: false },
  { type: 'thinking', text: 'bar', isSubagent: false, replace: true },
];

// todo_list_updated: two consecutive → REPLACE.
export const todoListConsecutiveEvents: WireEvent[] = [
  { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'pending' }], source: 'model-tool', isSubagent: false },
  { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'pending' }, { id: '2', content: 'B', status: 'pending' }], source: 'model-tool', isSubagent: false },
];

// todo_list_updated separated by text_delta → APPEND.
export const todoListSeparatedEvents: WireEvent[] = [
  { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'pending' }], source: 'model-tool', isSubagent: false },
  { type: 'text_delta', text: 'progress', isSubagent: false },
  { type: 'todo_list_updated', items: [{ id: '1', content: 'A', status: 'pending' }, { id: '2', content: 'B', status: 'pending' }], source: 'model-tool', isSubagent: false },
];

// Subagent lifecycle: started → progress → text + tool inside → completed.
export const subagentLifecycleEvents: WireEvent[] = [
  { type: 'subagent_started', taskId: 'sub-1', description: 'doing it', toolUseId: 'tu-sub1' },
  { type: 'subagent_progress', taskId: 'sub-1', description: 'still doing it', lastToolName: 'Grep' },
  { type: 'text_delta', text: 'sub thought', isSubagent: true, subagentTaskId: 'sub-1' },
  { type: 'tool_use', toolName: 'Grep', toolUseId: 't-sub-1', input: { q: 'x' }, isSubagent: true, subagentTaskId: 'sub-1' },
  { type: 'tool_result', toolUseId: 't-sub-1', summary: 'sub ok', isSubagent: true, subagentTaskId: 'sub-1' },
  { type: 'subagent_completed', taskId: 'sub-1', status: 'completed', summary: 'sub done', usage: { inputTokens: 5, outputTokens: 7 } },
];

// Error mid-stream after partial text.
export const errorMidStreamEvents: WireEvent[] = [
  turnStart('srv-u1'),
  { type: 'text_delta', text: 'partial', isSubagent: false },
  { type: 'error', error: 'kaboom', code: 'E_BAD' },
];

export function makeUserInputRequest(requestId: string): UserInputRequest {
  return {
    requestId,
    source: 'model-tool',
    origin: 'claude-code',
    questions: [{ question: 'Continue?', options: [{ label: 'yes' }, { label: 'no' }] }],
  };
}
