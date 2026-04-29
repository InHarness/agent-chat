import type { ThreadStore } from './thread-store.js';
import type { StoredContentBlock, StoredMessage, WireUsageStats } from './protocol.js';

export interface PersistTurnArgs {
  threads: ThreadStore;
  threadId: string;
  userMessage: StoredMessage;
  assistantMessageId: string;
  assistantBlocks: StoredContentBlock[];
  resultUsage: WireUsageStats | undefined;
  resultSessionId: string | undefined;
}

export function persistTurn(args: PersistTurnArgs): void {
  const {
    threads,
    threadId,
    userMessage,
    assistantMessageId,
    assistantBlocks,
    resultUsage,
    resultSessionId,
  } = args;

  const assistantMessage: StoredMessage = {
    id: assistantMessageId,
    role: 'assistant',
    blocks: assistantBlocks,
    timestamp: new Date().toISOString(),
    ...(resultUsage ? { usage: resultUsage } : {}),
  };

  threads.appendMessages(threadId, [userMessage, assistantMessage], resultSessionId);
}
