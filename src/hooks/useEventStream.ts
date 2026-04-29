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

  const { chatPath, abortPath, streamByThread } = useMemo(() => ({
    chatPath: options.endpoints?.chat ?? '/api/chat',
    abortPath: options.endpoints?.abort ?? '/api/chat/abort',
    streamByThread: options.endpoints?.streamByThread ?? defaultStreamByThread,
  }), [options.endpoints?.chat, options.endpoints?.abort, options.endpoints?.streamByThread]);

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
        await fetch(`${options.serverUrl}${abortPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId }),
        });
      } catch (err) {
        logger.warn('useEventStream.abort', err);
      }
    }
  }, [options.serverUrl, abortPath, logger]);

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

  return { startStream, joinStream, abort, disconnect };
}
