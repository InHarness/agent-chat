import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { handleTurnStart } from './turnStart.js';
import { handleTextDelta } from './textDelta.js';
import { handleThinking } from './thinking.js';
import { handleToolUse } from './toolUse.js';
import { handleToolResult } from './toolResult.js';
import { handleTodoListUpdated } from './todoList.js';
import { handleSubagentStarted, handleSubagentProgress, handleSubagentCompleted } from './subagentLifecycle.js';
import { handleUserInputRequest, handleUserInputResponse } from './userInput.js';
import { handleResult } from './result.js';
import { handleUserMessage } from './userMessage.js';
import { handleQueueUpdated } from './queueUpdated.js';
import { handleQueueCleared } from './queueCleared.js';
import { handleError } from './error.js';
import { handleDone } from './done.js';

type EventByType<T extends WireEvent['type']> = Extract<WireEvent, { type: T }>;
type Handler<T extends WireEvent['type']> = (state: ChatState, event: EventByType<T>) => ChatState;

type HandlerMap = { [T in WireEvent['type']]: Handler<T> };

const identity = <T extends WireEvent['type']>(state: ChatState, _event: EventByType<T>): ChatState => state;

const HANDLERS: HandlerMap = {
  connected: identity,
  turn_start: handleTurnStart,
  text_delta: handleTextDelta,
  thinking: handleThinking,
  tool_use: handleToolUse,
  tool_result: handleToolResult,
  todo_list_updated: handleTodoListUpdated,
  assistant_message: identity, // we build from deltas, don't replace
  subagent_started: handleSubagentStarted,
  subagent_progress: handleSubagentProgress,
  subagent_completed: handleSubagentCompleted,
  user_input_request: handleUserInputRequest,
  user_input_response: handleUserInputResponse,
  result: handleResult,
  user_message: handleUserMessage,
  queue_updated: handleQueueUpdated,
  queue_cleared: handleQueueCleared,
  error: handleError,
  flush: identity,
  done: handleDone,
};

// Frames that only mean something inside an open turn. While no assistant
// message is active (before the first `turn_start`, after `done` / `error`)
// they are dropped whole — including `result`'s counters, so the hook's
// `usage` never holds tokens no message (and so no reloaded thread) carries.
const REQUIRES_ACTIVE_MESSAGE = new Set<WireEvent['type']>([
  'text_delta',
  'thinking',
  'tool_use',
  'tool_result',
  'todo_list_updated',
  'assistant_message',
  'subagent_started',
  'subagent_progress',
  'subagent_completed',
  'user_input_request',
  'result',
  'user_message',
  'flush',
]);

export function dispatchEvent(state: ChatState, event: WireEvent): ChatState {
  if (state.activeAssistantMessageId === null && REQUIRES_ACTIVE_MESSAGE.has(event.type)) return state;
  const handler = HANDLERS[event.type] as ((s: ChatState, e: WireEvent) => ChatState) | undefined;
  return handler ? handler(state, event) : state;
}
