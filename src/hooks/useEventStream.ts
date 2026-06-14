import { useRef, useCallback, useMemo } from 'react';
import type { WireEvent, ChatRequest } from '../server/protocol.js';
import { defaultLogger, type Logger } from '../utils/logger.js';

/**
 * Per-endpoint overrides for the chat-stream HTTP surface. Each field is optional
 * and defaults to the canonical path served by `createChatHandler` from
 * `@inharness-ai/agent-chat/server`. Provide overrides when your backend exposes
 * a different routing layout.
 */
export interface StreamEndpoints {
  /** POST: start a chat turn (returns SSE). Default: '/api/chat'. */
  chat?: string;
  /** POST: abort an in-flight stream by `requestId`. Default: '/api/chat/abort'. */
  abort?: string;
  /** GET: join an in-flight stream for the given thread. Default: (id) => `/api/chat/stream/${encodeURIComponent(id)}`. */
  streamByThread?: (threadId: string) => string;
  /** POST: enqueue a message for a thread whose turn is live. Default: (id) => `/api/chat/queue/${encodeURIComponent(id)}`. */
  queue?: (threadId: string) => string;
  /** DELETE: cancel a single queued message. Default: (id, mid) => `/api/chat/queue/${encodeURIComponent(id)}/${encodeURIComponent(mid)}`. */
  queueItem?: (threadId: string, messageId: string) => string;
  /** DELETE: clear a thread's whole queue. Default: (id) => `/api/chat/queue/${encodeURIComponent(id)}`. */
  queueClear?: (threadId: string) => string;
}

interface StreamOptions {
  serverUrl: string;
  onEvent: (event: WireEvent) => void;
  onError: (error: Error) => void;
  onConnected?: (requestId: string, threadId: string) => void;
  endpoints?: StreamEndpoints;
  logger?: Logger;
}

const defaultStreamByThread = (threadId: string) =>
  `/api/chat/stream/${encodeURIComponent(threadId)}`;
const defaultQueue = (threadId: string) =>
  `/api/chat/queue/${encodeURIComponent(threadId)}`;
const defaultQueueItem = (threadId: string, messageId: string) =>
  `/api/chat/queue/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}`;

async function consumeSSE(
  response: Response,
  onEvent: (event: string, id: string | null, data: string) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentId: string | null = null;
  let currentData = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('id: ')) {
        currentId = line.slice(4);
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line === '' && currentEvent && currentData) {
        onEvent(currentEvent, currentId, currentData);
        currentEvent = '';
        currentId = null;
        currentData = '';
      }
    }
  }
}

export function useEventStream(options: StreamOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const joinAbortRef = useRef<AbortController | null>(null);
  const logger = options.logger ?? defaultLogger;

  const { chatPath, abortPath, streamByThread, queuePath, queueItemPath, queueClearPath } = useMemo(() => ({
    chatPath: options.endpoints?.chat ?? '/api/chat',
    abortPath: options.endpoints?.abort ?? '/api/chat/abort',
    streamByThread: options.endpoints?.streamByThread ?? defaultStreamByThread,
    queuePath: options.endpoints?.queue ?? defaultQueue,
    queueItemPath: options.endpoints?.queueItem ?? defaultQueueItem,
    queueClearPath: options.endpoints?.queueClear ?? defaultQueue,
  }), [
    options.endpoints?.chat,
    options.endpoints?.abort,
    options.endpoints?.streamByThread,
    options.endpoints?.queue,
    options.endpoints?.queueItem,
    options.endpoints?.queueClear,
  ]);

  const startStream = useCallback(async (request: ChatRequest) => {
    // Abort any existing stream (primary request + any piggyback join)
    abortControllerRef.current?.abort();
    joinAbortRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${options.serverUrl}${chatPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error ?? body.errors?.[0]?.message ?? `HTTP ${response.status}`);
      }

      await consumeSSE(response, (event, _id, data) => {
        try {
          const parsed = JSON.parse(data);
          if (event === 'connected') {
            requestIdRef.current = parsed.requestId;
            options.onConnected?.(parsed.requestId, parsed.threadId);
          } else if (event === 'done') {
            // Stream complete
          } else {
            options.onEvent({ type: event, ...parsed } as WireEvent);
          }
        } catch (err) {
          logger.warn('useEventStream.startStream.parse', err);
        }
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      options.onError(err as Error);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        requestIdRef.current = null;
      }
    }
  }, [options.serverUrl, options.onEvent, options.onError, options.onConnected, chatPath, logger]);

  /**
   * Try to join an in-flight stream for the given thread. Returns `true` when
   * successfully connected, `false` when the thread has no active stream (so
   * the caller can rely on the static history replay). Silently aborts when a
   * subsequent call supersedes it.
   */
  const joinStream = useCallback(async (threadId: string): Promise<boolean> => {
    joinAbortRef.current?.abort();
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    joinAbortRef.current = controller;

    let connected = false;
    try {
      const response = await fetch(`${options.serverUrl}${streamByThread(threadId)}`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      if (response.status === 404) return false;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      connected = true;
      await consumeSSE(response, (event, _id, data) => {
        try {
          const parsed = JSON.parse(data);
          if (event === 'connected') {
            requestIdRef.current = parsed.requestId;
            options.onConnected?.(parsed.requestId, parsed.threadId);
          } else if (event === 'done') {
            // Live stream ended
          } else {
            options.onEvent({ type: event, ...parsed } as WireEvent);
          }
        } catch (err) {
          logger.warn('useEventStream.joinStream.parse', err);
        }
      });
      return true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return connected;
      options.onError(err as Error);
      return false;
    } finally {
      if (joinAbortRef.current === controller) {
        joinAbortRef.current = null;
      }
    }
  }, [options.serverUrl, options.onEvent, options.onError, options.onConnected, streamByThread, logger]);

  /**
   * Stop the current turn: close the local SSE connection AND tell the server
   * to abort the adapter (`POST /api/chat/abort` with `requestId`). Use this for
   * an explicit user-driven Stop button.
   *
   * D4: aborting closes our own SSE, so the server's `queue_cleared` broadcast
   * cannot reach us. Instead we read the cleared texts from the abort response
   * and feed them back through `onEvent` as a synthetic `queue_cleared` — same
   * path as a broadcast, so the reducer and `onQueueCleared` fire identically.
   */
  const abort = useCallback(async () => {
    const requestId = requestIdRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    joinAbortRef.current?.abort();
    joinAbortRef.current = null;
    requestIdRef.current = null;

    if (requestId) {
      try {
        const res = await fetch(`${options.serverUrl}${abortPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId }),
        });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          const texts = (body as { clearedTexts?: unknown }).clearedTexts;
          if (Array.isArray(texts) && texts.length > 0) {
            options.onEvent({ type: 'queue_cleared', texts: texts as string[] });
          }
        }
      } catch (err) {
        logger.warn('useEventStream.abort', err);
      }
    }
  }, [options.serverUrl, abortPath, options.onEvent, logger]);

  /**
   * Close the local SSE connection without telling the server to stop. The
   * server-side adapter keeps running and persists events; the client can later
   * reattach via `joinStream(threadId)`. Use this for thread switches, F5
   * recovery, or any scenario where the UI needs to detach without ending the
   * turn.
   */
  const disconnect = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    joinAbortRef.current?.abort();
    joinAbortRef.current = null;
    // requestIdRef intentionally NOT cleared — server-side keeps running and a
    // later abort() call (or other code path) may still need this requestId.
  }, []);

  /**
   * Enqueue a message for a thread whose turn is live (composer stayed unlocked).
   * The server replies 202 with the queue snapshot and also broadcasts
   * `queue_updated` over the open SSE, which is what actually updates the UI.
   * Throws on a non-2xx response (e.g. 400 QUEUE_FULL, 409 NO_ACTIVE_STREAM) so
   * the caller can surface it; the message stays in the composer.
   */
  const queueMessage = useCallback(async (threadId: string, payload: { prompt: string }) => {
    const response = await fetch(`${options.serverUrl}${queuePath(threadId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(body.error ?? body.errors?.[0]?.message ?? `HTTP ${response.status}`);
    }
  }, [options.serverUrl, queuePath]);

  /** Cancel a single queued message. Fire-and-forget — the server broadcasts the
   * resulting `queue_updated`. */
  const cancelQueued = useCallback(async (threadId: string, messageId: string) => {
    try {
      await fetch(`${options.serverUrl}${queueItemPath(threadId, messageId)}`, { method: 'DELETE' });
    } catch (err) {
      logger.warn('useEventStream.cancelQueued', err);
    }
  }, [options.serverUrl, queueItemPath, logger]);

  /** Clear a thread's whole queue. Fire-and-forget — the server broadcasts
   * `queue_cleared` (with the cleared texts for composer restoration). */
  const clearQueue = useCallback(async (threadId: string) => {
    try {
      await fetch(`${options.serverUrl}${queueClearPath(threadId)}`, { method: 'DELETE' });
    } catch (err) {
      logger.warn('useEventStream.clearQueue', err);
    }
  }, [options.serverUrl, queueClearPath, logger]);

  return { startStream, joinStream, abort, disconnect, queueMessage, cancelQueued, clearQueue };
}
