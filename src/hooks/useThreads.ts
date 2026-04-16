import { useState, useCallback } from 'react';
import type { ThreadMeta, StoredThread } from '../server/protocol.js';
import type { ChatMessage } from '../types.js';
import { storedMessageToChat } from '../types.js';

interface UseThreadsOptions {
  serverUrl: string;
  onThreadLoaded: (messages: ChatMessage[], sessionId?: string, architecture?: string, model?: string, cwd?: string, systemPrompt?: string, maxTurns?: number) => void;
}

export function useThreads({ serverUrl, onThreadLoaded }: UseThreadsOptions) {
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch(`${serverUrl}/api/threads`);
      if (res.ok) {
        setThreads(await res.json());
      }
    } catch {
      // Silent fail for thread list
    }
  }, [serverUrl]);

  const loadThread = useCallback(async (threadId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/threads/${threadId}`);
      if (!res.ok) throw new Error('Thread not found');
      const thread: StoredThread = await res.json();

      setActiveThreadId(threadId);
      const messages = thread.messages.map(storedMessageToChat);
      onThreadLoaded(messages, thread.sessionId, thread.architecture, thread.model, thread.cwd, thread.systemPrompt, thread.maxTurns);
    } catch {
      // Thread load failed
    } finally {
      setLoading(false);
    }
  }, [serverUrl, onThreadLoaded]);

  const createThread = useCallback(async (architecture: string, model: string, opts?: { cwd?: string; systemPrompt?: string; maxTurns?: number }): Promise<string | null> => {
    try {
      const res = await fetch(`${serverUrl}/api/threads`, {
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
  }, [serverUrl, refreshThreads]);

  const deleteThread = useCallback(async (threadId: string) => {
    try {
      await fetch(`${serverUrl}/api/threads/${threadId}`, { method: 'DELETE' });
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        onThreadLoaded([]); // Clear messages
      }
      await refreshThreads();
    } catch {
      // Silent fail
    }
  }, [serverUrl, activeThreadId, onThreadLoaded, refreshThreads]);

  const renameThread = useCallback(async (threadId: string, title: string) => {
    try {
      await fetch(`${serverUrl}/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      await refreshThreads();
    } catch {
      // Silent fail
    }
  }, [serverUrl, refreshThreads]);

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
