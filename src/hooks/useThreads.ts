import { useState, useCallback, useMemo } from 'react';
import type { ThreadMeta, StoredThread } from '../server/protocol.js';
import { defaultLogger, type Logger } from '../utils/logger.js';

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
  endpoints?: ThreadsEndpoints;
  logger?: Logger;
}

const defaultThreadById = (threadId: string) =>
  `/api/threads/${encodeURIComponent(threadId)}`;

export function useThreads({ serverUrl, endpoints, logger = defaultLogger }: UseThreadsOptions) {
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
    } catch (err) {
      logger.warn('useThreads.refresh', err);
    }
  }, [serverUrl, threadsPath, logger]);

  const loadThread = useCallback(async (threadId: string): Promise<StoredThread | null> => {
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}${threadById(threadId)}`);
      if (!res.ok) throw new Error('Thread not found');
      const thread: StoredThread = await res.json();
      setActiveThreadId(threadId);
      return thread;
    } catch (err) {
      logger.warn('useThreads.load', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [serverUrl, threadById, logger]);

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
    } catch (err) {
      logger.warn('useThreads.create', err);
      return null;
    }
  }, [serverUrl, refreshThreads, threadsPath, logger]);

  const deleteThread = useCallback(async (threadId: string): Promise<{ deletedActive: boolean }> => {
    let deletedActive = false;
    try {
      await fetch(`${serverUrl}${threadById(threadId)}`, { method: 'DELETE' });
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        deletedActive = true;
      }
      await refreshThreads();
    } catch (err) {
      logger.warn('useThreads.delete', err);
    }
    return { deletedActive };
  }, [serverUrl, activeThreadId, refreshThreads, threadById, logger]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    try {
      await fetch(`${serverUrl}${threadById(threadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      await refreshThreads();
    } catch (err) {
      logger.warn('useThreads.rename', err);
    }
  }, [serverUrl, refreshThreads, threadById, logger]);

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
