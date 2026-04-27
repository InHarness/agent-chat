import { useState, useCallback, useMemo } from 'react';
import type { ThreadMeta, StoredThread } from '../server/protocol.js';
import type { ChatMessage } from '../types.js';
import { storedMessageToChat } from '../types.js';

/**
 * Per-endpoint overrides for the threads HTTP surface. Each field is optional
 * and defaults to the canonical path served by `createChatHandler` from
 * `@inharness-ai/agent-chat/server`. Provide overrides when your backend exposes
 * a different routing layout.
 */
export interface ThreadsEndpoints {
  /** GET (list) and POST (create). Default: '/api/threads'. */
  threads?: string;
  /** GET one + DELETE + PATCH by threadId. Default: (id) => `/api/threads/${encodeURIComponent(id)}`. */
  threadById?: (threadId: string) => string;
}

interface UseThreadsOptions {
  serverUrl: string;
  onThreadLoaded: (
    messages: ChatMessage[],
    sessionId?: string,
    architecture?: string,
    model?: string,
    cwd?: string,
    systemPrompt?: string,
    maxTurns?: number,
    architectureConfig?: Record<string, unknown>,
    planMode?: boolean,
  ) => void;
  endpoints?: ThreadsEndpoints;
}

const defaultThreadById = (threadId: string) =>
  `/api/threads/${encodeURIComponent(threadId)}`;

export function useThreads({ serverUrl, onThreadLoaded, endpoints }: UseThreadsOptions) {
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { threadsPath, threadById } = useMemo(() => ({
    threadsPath: endpoints?.threads ?? '/api/threads',
    threadById: endpoints?.threadById ?? defaultThreadById,
  }), [endpoints?.threads, endpoints?.threadById]);

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch(`${serverUrl}${threadsPath}`);
      if (res.ok) {
        setThreads(await res.json());
      }
    } catch {
      // Silent fail for thread list
    }
  }, [serverUrl, threadsPath]);

  const loadThread = useCallback(async (threadId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}${threadById(threadId)}`);
      if (!res.ok) throw new Error('Thread not found');
      const thread: StoredThread = await res.json();

      setActiveThreadId(threadId);
      const messages = thread.messages.map(storedMessageToChat);
      onThreadLoaded(
        messages,
        thread.sessionId,
        thread.architecture,
        thread.model,
        thread.cwd,
        thread.systemPrompt,
        thread.maxTurns,
        thread.architectureConfig,
        thread.planMode,
      );
    } catch {
      // Thread load failed
    } finally {
      setLoading(false);
    }
  }, [serverUrl, onThreadLoaded, threadById]);

  const createThread = useCallback(async (architecture: string, model: string, opts?: { cwd?: string; systemPrompt?: string; maxTurns?: number; architectureConfig?: Record<string, unknown>; planMode?: boolean }): Promise<string | null> => {
    try {
      const res = await fetch(`${serverUrl}${threadsPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ architecture, model, ...opts }),
      });
      if (!res.ok) return null;
      const thread: ThreadMeta = await res.json();
      setActiveThreadId(thread.id);
      await refreshThreads();
      return thread.id;
    } catch {
      return null;
    }
  }, [serverUrl, refreshThreads, threadsPath]);

  const deleteThread = useCallback(async (threadId: string) => {
    try {
      await fetch(`${serverUrl}${threadById(threadId)}`, { method: 'DELETE' });
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        onThreadLoaded([]); // Clear messages
      }
      await refreshThreads();
    } catch {
      // Silent fail
    }
  }, [serverUrl, activeThreadId, onThreadLoaded, refreshThreads, threadById]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    try {
      await fetch(`${serverUrl}${threadById(threadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      await refreshThreads();
    } catch {
      // Silent fail
    }
  }, [serverUrl, refreshThreads, threadById]);

  return {
    threads,
    activeThreadId,
    setActiveThreadId,
    loading,
    refreshThreads,
    loadThread,
    createThread,
    deleteThread,
    renameThread,
  };
}
