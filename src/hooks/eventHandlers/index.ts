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
import { handleError } from './error.js';

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
  error: handleError,
  flush: identity,
  done: identity,
};

export function dispatchEvent(state: ChatState, event: WireEvent): ChatState {
  const handler = HANDLERS[event.type] as ((s: ChatState, e: WireEvent) => ChatState) | undefined;
  return handler ? handler(state, event) : state;
}
