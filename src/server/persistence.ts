import type { ThreadStore } from './thread-store.js';
import type { StoredContentBlock, StoredMessage, WireUsageStats } from './protocol.js';

export interface PersistTurnArgs {
  threads: ThreadStore;
  threadId: string;
  userMessage: StoredMessage;
  assistantMessageId: string;
  assistantBlocks: StoredContentBlock[];
  resultUsage: WireUsageStats | undefined;
  /**
   * Post-turn context-window utilization (`usage.inputTokens + usage.outputTokens`).
   * Persisted alongside `usage` so reload (F5) can show the correct bar value
   * without recomputing — and so future RESTORE never has to derive it.
   */
  resultContextSize: number | undefined;
  resultSessionId: string | undefined;
  /** Architecture used for this turn — stamped on user + assistant message. */
  architecture: string;
  /** Model alias used for this turn — stamped on user + assistant message. */
  model: string;
}

export function persistTurn(args: PersistTurnArgs): void {
  const {
    threads,
    threadId,
    userMessage,
    assistantMessageId,
    assistantBlocks,
    resultUsage,
    resultContextSize,
    resultSessionId,
    architecture,
    model,
  } = args;

  const stampedUser: StoredMessage = {
    ...userMessage,
    architecture,
    model,
  };

  const assistantMessage: StoredMessage = {
    id: assistantMessageId,
    role: 'assistant',
    blocks: assistantBlocks,
    timestamp: new Date().toISOString(),
    architecture,
    model,
    ...(resultUsage ? { usage: resultUsage } : {}),
    ...(resultContextSize !== undefined ? { contextSize: resultContextSize } : {}),
  };

  threads.appendMessages(threadId, [stampedUser, assistantMessage], resultSessionId);
}
