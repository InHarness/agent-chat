// Client-side types for the React chat UI

import type {
  WireEvent,
  ServerConfig,
  ThreadMeta,
  StoredContentBlock,
} from './server/protocol.js';
import type { ToolCategory } from './utils/toolCategory.js';

// Re-export wire types for consumers
export type { WireEvent, ServerConfig, ThreadMeta };
export type { ArchOption, ArchOptionType } from '@inharness/agent-adapters';
export type { ToolCategory } from './utils/toolCategory.js';

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
  | { type: 'toolBatch'; category: ToolCategory; items: ToolBatchItem[] };

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
}

// --- Hook Config ---

export interface AgentChatConfig {
  serverUrl: string;
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
