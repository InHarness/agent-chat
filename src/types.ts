// Client-side types for the React chat UI

import type {
  WireEvent,
  ServerConfig,
  ThreadMeta,
  StoredContentBlock,
} from './server/protocol.js';
import type { ToolCategory } from './utils/toolCategory.js';
import type { TodoItem, UserInputRequest, UserInputResponse } from '@inharness-ai/agent-adapters';
import type { ToolRendererRegistry } from './tools/types.js';

// Re-export wire types for consumers
export type { WireEvent, ServerConfig, ThreadMeta };
export type { ArchOption, ArchOptionType } from '@inharness-ai/agent-adapters';
export type { ToolCategory } from './utils/toolCategory.js';
/**
 * TODO list item. `activeForm` is populated by claude-code for `in_progress`
 * items (present-continuous label); `priority` is populated by opencode only.
 */
export type { TodoItem } from '@inharness-ai/agent-adapters';

// --- UI Content Blocks ---

export interface ToolBatchItem {
  toolUseId: string;
  toolName: string;
  input: unknown;
  result?: { content: string; isError: boolean };
}

export type UIContentBlock =
  | { type: 'text'; text: string; isStreaming: boolean }
  | { type: 'thinking'; text: string; isStreaming: boolean; collapsed: boolean }
  | { type: 'toolUse'; toolUseId: string; toolName: string; input: unknown; collapsed: boolean }
  | { type: 'toolResult'; toolUseId: string; content: string; isError: boolean; collapsed: boolean }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string } }
  | { type: 'subagent'; taskId: string; toolUseId: string; description: string; status: string; summary?: string; messages: ChatMessage[]; usage?: UsageStats }
  | { type: 'toolBatch'; category: ToolCategory; items: ToolBatchItem[] }
  | { type: 'todoList'; items: TodoItem[] }
  | { type: 'userInputRequest'; requestId: string; request: UserInputRequest; response?: UserInputResponse };

// --- Chat Message ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: UIContentBlock[];
  timestamp: string;
  isStreaming: boolean;
  subagentTaskId?: string;
  usage?: UsageStats;
}

// --- Chat State ---

export interface SubagentState {
  taskId: string;
  description: string;
  toolUseId: string;
  status: 'running' | 'completed' | 'failed';
  lastToolName?: string;
  summary?: string;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ChatState {
  messages: ChatMessage[];
  activeAssistantMessageId: string | null;
  activeSubagents: Map<string, SubagentState>;
  isStreaming: boolean;
  error: Error | null;
  usage: UsageStats | null;
  sessionId: string | null;
  architecture: string;
  model: string;
  /** Latest TODO list snapshot for the active thread (sticky header). */
  currentTodoItems: TodoItem[] | null;
}

// --- Hook Config ---

export interface AgentChatConfig {
  serverUrl: string;
  /**
   * Optional per-endpoint overrides for the chat-stream and threads HTTP
   * surfaces. Both inner objects are forwarded to `useEventStream` and
   * `useThreads` respectively. Defaults match the canonical paths served by
   * `createChatHandler` from `@inharness-ai/agent-chat/server`.
   */
  endpoints?: {
    stream?: import('./hooks/useEventStream.js').StreamEndpoints;
    threads?: import('./hooks/useThreads.js').ThreadsEndpoints;
  };
}

// --- Component Props ---

export interface AgentChatProps {
  serverUrl: string;
  theme?: 'light' | 'dark';
  onThemeChange?: (theme: 'light' | 'dark') => void;
  className?: string;
  showConfigBar?: boolean;
  showThreadList?: boolean;
  showUsage?: boolean;
  /**
   * When true, consecutive same-category tool calls are grouped into a single
   * expandable summary block (e.g. "Edited 5 files"). Default: false.
   */
  batchTools?: boolean;
  /**
   * Override the per-tool renderer registry. Keys match `toolName` from the wire.
   * Defaults to `claudeCodeToolRenderers`; merge with it to add custom tools:
   *   `toolRenderers={{ ...claudeCodeToolRenderers, myTool: { summary: ... } }}`
   */
  toolRenderers?: ToolRendererRegistry;
}

// --- Conversion helpers ---

export function storedBlockToUI(block: StoredContentBlock): UIContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, isStreaming: false };
    case 'thinking':
      return { type: 'thinking', text: block.text, isStreaming: false, collapsed: true };
    case 'toolUse':
      return { type: 'toolUse', toolUseId: block.toolUseId, toolName: block.toolName, input: block.input, collapsed: true };
    case 'toolResult':
      return { type: 'toolResult', toolUseId: block.toolUseId, content: block.content, isError: block.isError ?? false, collapsed: true };
    case 'image':
      return { type: 'image', source: block.source };
    case 'subagent':
      return {
        type: 'subagent',
        taskId: block.taskId,
        toolUseId: block.toolUseId,
        description: block.description,
        status: block.status,
        summary: block.summary,
        messages: block.messages.map(storedMessageToChat),
        usage: block.usage,
      };
    case 'todoList':
      return { type: 'todoList', items: block.items };
    case 'userInputRequest':
      return {
        type: 'userInputRequest',
        requestId: block.requestId,
        request: block.request,
        response: block.response,
      };
  }
}

export function storedMessageToChat(msg: { id: string; role: 'user' | 'assistant'; blocks: StoredContentBlock[]; timestamp: string; subagentTaskId?: string; usage?: UsageStats }): ChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    blocks: msg.blocks.map(storedBlockToUI),
    timestamp: msg.timestamp,
    isStreaming: false,
    subagentTaskId: msg.subagentTaskId,
    usage: msg.usage,
  };
}
