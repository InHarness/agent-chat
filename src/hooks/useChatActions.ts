import { useCallback, type MutableRefObject } from 'react';
import type { UserInputResponse } from '@inharness-ai/agent-adapters';
import type { ChatState } from '../types.js';
import type { ChatRequest, WireEvent } from '../server/protocol.js';

export interface ChatActionRequest {
  activeThreadId: string | null;
  architecture: string;
  model: string;
  cwd: string;
  systemPrompt: string;
  maxTurns: number | undefined;
  architectureConfig: Record<string, unknown>;
  planMode: boolean;
}

export interface UseChatActionsParams {
  serverUrl: string;
  stateRef: MutableRefObject<ChatState>;
  sendUserMessage: (text: string) => void;
  handleWireEvent: (e: WireEvent) => void;
  startStream: (request: ChatRequest) => Promise<void>;
  abortStream: () => Promise<void> | void;
  queueMessage: (threadId: string, payload: { prompt: string }) => Promise<void>;
  cancelQueued: (threadId: string, messageId: string) => Promise<void>;
  clearQueue: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  getRequest: () => ChatActionRequest;
}

export function useChatActions(params: UseChatActionsParams) {
  const {
    serverUrl,
    stateRef,
    sendUserMessage,
    handleWireEvent,
    startStream,
    abortStream,
    queueMessage,
    cancelQueued,
    clearQueue,
    refreshThreads,
    getRequest,
  } = params;

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Composer stays unlocked during a turn: route to the queue instead of
    // blocking. The server delivers it mid-turn (push) or after the turn
    // (merged dispatch) and broadcasts `queue_updated`, which renders the chip.
    const o = getRequest();
    if (stateRef.current.isStreaming) {
      if (!o.activeThreadId) return; // no live thread to enqueue against
      try {
        await queueMessage(o.activeThreadId, { prompt: trimmed });
      } catch (e) {
        handleWireEvent({
          type: 'error',
          error: (e as Error).message ?? 'Failed to queue message',
          code: 'QUEUE_ERROR',
        });
      }
      return;
    }

    sendUserMessage(trimmed);

    await startStream({
      prompt: trimmed,
      threadId: o.activeThreadId ?? undefined,
      architecture: o.architecture,
      model: o.model,
      sessionId: stateRef.current.sessionId ?? undefined,
      cwd: o.activeThreadId ? undefined : o.cwd || undefined,
      systemPrompt: o.systemPrompt || undefined,
      maxTurns: o.maxTurns,
      architectureConfig: Object.keys(o.architectureConfig).length > 0 ? o.architectureConfig : undefined,
      planMode: o.planMode || undefined,
    });

    await refreshThreads();
  }, [stateRef, sendUserMessage, handleWireEvent, getRequest, startStream, queueMessage, refreshThreads]);

  const cancelQueuedMessage = useCallback(async (messageId: string) => {
    const { activeThreadId } = getRequest();
    if (!activeThreadId) return;
    await cancelQueued(activeThreadId, messageId);
  }, [getRequest, cancelQueued]);

  const clearQueuedMessages = useCallback(async () => {
    const { activeThreadId } = getRequest();
    if (!activeThreadId) return;
    await clearQueue(activeThreadId);
  }, [getRequest, clearQueue]);

  const abort = useCallback(() => {
    // Fire-and-forget Stop. The server clears the thread's queue and broadcasts
    // `queue_cleared` (with the texts) over SSE; the composer restoration (D4)
    // happens via `AgentChatConfig.onQueueCleared`, not the abort response.
    abortStream();
    handleWireEvent({ type: 'error', error: 'Request aborted', code: 'ABORTED' });
  }, [abortStream, handleWireEvent]);

  const sendUserInputResponse = useCallback(async (requestId: string, response: UserInputResponse) => {
    // Optimistic local update so the card reflects the answer instantly.
    handleWireEvent({ type: 'user_input_response', requestId, response });
    try {
      const res = await fetch(`${serverUrl}/api/chat/user-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, response }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(err || `user-input failed: ${res.status}`);
      }
    } catch (e) {
      handleWireEvent({
        type: 'error',
        error: (e as Error).message ?? 'Failed to submit user input',
        code: 'USER_INPUT_ERROR',
      });
    }
  }, [serverUrl, handleWireEvent]);

  return { sendMessage, abort, sendUserInputResponse, cancelQueuedMessage, clearQueue: clearQueuedMessages };
}
