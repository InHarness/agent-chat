// Wire format types — shared between client and server
// These mirror UnifiedEvent from @inharness/agent-adapters but are JSON-safe

import type { ArchOption } from '@inharness/agent-adapters';

export interface WireContentBlock {
  type: 'text' | 'thinking' | 'toolUse' | 'toolResult' | 'image';
  text?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  content?: string;
  isError?: boolean;
  source?: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string };
}

export interface WireNormalizedMessage {
  role: 'user' | 'assistant';
  content: WireContentBlock[];
  timestamp: string;
  subagentTaskId?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export type WireEvent =
  | { type: 'connected'; requestId: string }
  | { type: 'text_delta'; text: string; isSubagent: boolean }
  | { type: 'thinking'; text: string; isSubagent: boolean; replace?: boolean }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: unknown; isSubagent: boolean }
  | { type: 'tool_result'; toolUseId: string; summary: string; isSubagent: boolean }
  | { type: 'assistant_message'; message: WireNormalizedMessage }
  | { type: 'subagent_started'; taskId: string; description: string; toolUseId: string }
  | { type: 'subagent_progress'; taskId: string; description: string; lastToolName?: string }
  | { type: 'subagent_completed'; taskId: string; status: string; summary?: string; usage?: unknown }
  | { type: 'result'; output: string; usage: { inputTokens: number; outputTokens: number }; sessionId?: string }
  | { type: 'error'; error: string; code: string }
  | { type: 'flush' }
  | { type: 'done' };

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
}

export type StoredContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'toolUse'; toolUseId: string; toolName: string; input: unknown }
  | { type: 'toolResult'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string } }
  | { type: 'subagent'; taskId: string; toolUseId: string; description: string; status: string; summary?: string; messages: StoredMessage[] };

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
