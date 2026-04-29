// Wire format types — shared between client and server
// These mirror UnifiedEvent from @inharness-ai/agent-adapters but are JSON-safe

import type { ArchOption, TodoItem, UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';

export interface WireContentBlock {
  type: 'text' | 'thinking' | 'toolUse' | 'toolResult' | 'image' | 'todoList';
  text?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  content?: string;
  isError?: boolean;
  source?: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string };
  items?: TodoItem[];
}

export interface WireUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface WireNormalizedMessage {
  role: 'user' | 'assistant';
  content: WireContentBlock[];
  timestamp: string;
  subagentTaskId?: string;
  usage?: WireUsageStats;
}

export type WireEvent =
  | { type: 'connected'; requestId: string }
  | { type: 'turn_start'; userMessageId: string; assistantMessageId: string; prompt: string; timestamp: string }
  | { type: 'text_delta'; text: string; isSubagent: boolean; subagentTaskId?: string }
  | { type: 'thinking'; text: string; isSubagent: boolean; replace?: boolean; subagentTaskId?: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: unknown; isSubagent: boolean; subagentTaskId?: string }
  | { type: 'tool_result'; toolUseId: string; summary: string; isSubagent: boolean; subagentTaskId?: string }
  | { type: 'todo_list_updated'; items: TodoItem[]; source: 'model-tool' | 'session-state'; isSubagent: boolean; subagentTaskId?: string }
  | { type: 'assistant_message'; message: WireNormalizedMessage }
  | { type: 'subagent_started'; taskId: string; description: string; toolUseId: string }
  | { type: 'subagent_progress'; taskId: string; description: string; lastToolName?: string }
  | { type: 'subagent_completed'; taskId: string; status: string; summary?: string; usage?: WireUsageStats }
  | { type: 'user_input_request'; request: UserInputRequest }
  | { type: 'user_input_response'; requestId: string; response: UserInputResponse }
  | { type: 'result'; output: string; usage: WireUsageStats; sessionId?: string }
  | { type: 'error'; error: string; code: string }
  | { type: 'flush' }
  | { type: 'done' };

// Re-export user input types so consumers don't need a separate import.
export type { UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';

// --- Type guards ---
// Useful for narrowing events parsed from SSE streams (JSON.parse returns
// `unknown` / a loosely-typed shape) and for branchy reducers where the
// surrounding switch isn't readily available.

export type WireEventOfType<T extends WireEvent['type']> = Extract<WireEvent, { type: T }>;

const guard = <T extends WireEvent['type']>(type: T) =>
  (event: WireEvent): event is WireEventOfType<T> => event.type === type;

export const isConnectedEvent = guard('connected');
export const isTurnStartEvent = guard('turn_start');
export const isTextDeltaEvent = guard('text_delta');
export const isThinkingEvent = guard('thinking');
export const isToolUseEvent = guard('tool_use');
export const isToolResultEvent = guard('tool_result');
export const isTodoListUpdatedEvent = guard('todo_list_updated');
export const isAssistantMessageEvent = guard('assistant_message');
export const isSubagentStartedEvent = guard('subagent_started');
export const isSubagentProgressEvent = guard('subagent_progress');
export const isSubagentCompletedEvent = guard('subagent_completed');
export const isUserInputRequestEvent = guard('user_input_request');
export const isUserInputResponseEvent = guard('user_input_response');
export const isResultEvent = guard('result');
export const isErrorEvent = guard('error');
export const isFlushEvent = guard('flush');
export const isDoneEvent = guard('done');

// --- Chat Request ---

export interface ChatRequest {
  prompt: string;
  threadId?: string;
  architecture?: string;
  model?: string;
  systemPrompt?: string;
  sessionId?: string;
  maxTurns?: number;
  allowedTools?: string[];
  architectureConfig?: Record<string, unknown>;
  cwd?: string;
  planMode?: boolean;
}

// --- Config ---

export interface ArchitectureConfig {
  models: string[];
  default: string;
  options: ArchOption[];
  /**
   * Maximum context window size (in tokens) per model alias.
   * Populated server-side from MODEL_CONTEXT_WINDOWS; absent for models
   * where the window depends on runtime configuration (Ollama, custom providers).
   */
  contextWindows?: Record<string, number>;
}

export interface ServerConfig {
  architectures: Record<string, ArchitectureConfig>;
  defaultArchitecture: string;
  defaultCwd: string;
}

// --- Threads ---

export interface ThreadMeta {
  id: string;
  title: string;
  architecture: string;
  model: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: StoredContentBlock[];
  timestamp: string;
  /** Task ID when this message belongs to a subagent (mirrors NormalizedMessage.subagentTaskId). */
  subagentTaskId?: string;
  /** Usage stats for this message's turn (mirrors NormalizedMessage.usage). */
  usage?: WireUsageStats;
  /**
   * Architecture this message was authored under. Set on persistence so the
   * thread keeps a true audit trail across architecture rollovers; older
   * threads written before this field existed read back as `undefined` (treat
   * as "the thread's current architecture at load time").
   */
  architecture?: string;
  /** Model alias this message was authored under (see `architecture`). */
  model?: string;
}

export type StoredContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'toolUse'; toolUseId: string; toolName: string; input: unknown }
  | { type: 'toolResult'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string } }
  | { type: 'subagent'; taskId: string; toolUseId: string; description: string; status: string; summary?: string; messages: StoredMessage[]; usage?: WireUsageStats }
  | { type: 'todoList'; items: TodoItem[] }
  | { type: 'userInputRequest'; requestId: string; request: UserInputRequest; response?: UserInputResponse };

export interface StoredThread {
  id: string;
  title: string;
  architecture: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  systemPrompt?: string;
  maxTurns?: number;
  architectureConfig?: Record<string, unknown>;
  planMode?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
}
