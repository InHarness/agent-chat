import { useRef, useCallback } from 'react';
import type { WireEvent, ChatRequest } from '../server/protocol.js';

interface StreamOptions {
  serverUrl: string;
  onEvent: (event: WireEvent) => void;
  onError: (error: Error) => void;
  onConnected?: (requestId: string, threadId: string) => void;
}

export function useEventStream(options: StreamOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const startStream = useCallback(async (request: ChatRequest) => {
    // Abort any existing stream
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${options.serverUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error ?? body.errors?.[0]?.message ?? `HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
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
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData);

              if (currentEvent === 'connected') {
                requestIdRef.current = parsed.requestId;
                options.onConnected?.(parsed.requestId, parsed.threadId);
              } else if (currentEvent === 'done') {
                // Stream complete
              } else {
                options.onEvent({ type: currentEvent, ...parsed } as WireEvent);
              }
            } catch {
              // Skip malformed events
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      options.onError(err as Error);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        requestIdRef.current = null;
      }
    }
  }, [options.serverUrl, options.onEvent, options.onError, options.onConnected]);

  const abort = useCallback(async () => {
    const requestId = requestIdRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestIdRef.current = null;

    if (requestId) {
      try {
        await fetch(`${options.serverUrl}/api/chat/abort`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId }),
        });
      } catch {
        // Best-effort abort
      }
    }
  }, [options.serverUrl]);

  return { startStream, abort };
}
