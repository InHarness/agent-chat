import type { ChatState } from '../../types.js';
import type { WireEvent } from '../../server/protocol.js';
import { updateActiveMessage } from './_shared.js';

type SubagentStartedEvent = Extract<WireEvent, { type: 'subagent_started' }>;
type SubagentProgressEvent = Extract<WireEvent, { type: 'subagent_progress' }>;
type SubagentCompletedEvent = Extract<WireEvent, { type: 'subagent_completed' }>;

export function handleSubagentStarted(state: ChatState, event: SubagentStartedEvent): ChatState {
  const newSubagents = new Map(state.activeSubagents);
  newSubagents.set(event.taskId, {
    taskId: event.taskId,
    description: event.description,
    toolUseId: event.toolUseId,
    status: 'running',
  });

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => [...blocks, {
      type: 'subagent' as const,
      taskId: event.taskId,
      toolUseId: event.toolUseId,
      description: event.description,
      status: 'running',
      messages: [],
    }],
  );
}

export function handleSubagentProgress(state: ChatState, event: SubagentProgressEvent): ChatState {
  const sub = state.activeSubagents.get(event.taskId);
  if (!sub) return state;

  const newSubagents = new Map(state.activeSubagents);
  newSubagents.set(event.taskId, { ...sub, description: event.description, lastToolName: event.lastToolName });

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => blocks.map(b =>
      b.type === 'subagent' && b.taskId === event.taskId
        ? { ...b, description: event.description }
        : b
    ),
  );
}

export function handleSubagentCompleted(state: ChatState, event: SubagentCompletedEvent): ChatState {
  const newSubagents = new Map(state.activeSubagents);
  newSubagents.delete(event.taskId);

  return updateActiveMessage(
    { ...state, activeSubagents: newSubagents },
    (blocks) => blocks.map(b =>
      b.type === 'subagent' && b.taskId === event.taskId
        ? { ...b, status: event.status, summary: event.summary, usage: event.usage }
        : b
    ),
  );
}
