import React from 'react';
import type { ThreadMeta } from '../server/protocol.js';
import { ThreadItem } from './ThreadItem.js';

interface ThreadListProps {
  threads: ThreadMeta[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onNewThread: () => void;
}

export function ThreadList({ threads, activeThreadId, onSelect, onDelete, onRename, onNewThread }: ThreadListProps) {
  return (
    <div data-ac="thread-list">
      <div data-ac="thread-list-header">
        <span data-ac="thread-list-title">Conversations</span>
        <button data-ac="new-thread-button" onClick={onNewThread} type="button">
          + New
        </button>
      </div>
      <div data-ac="thread-list-items">
        {threads.length === 0 ? (
          <div data-ac="thread-list-empty">No conversations yet</div>
        ) : (
          threads.map(thread => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onSelect={() => onSelect(thread.id)}
              onDelete={() => onDelete(thread.id)}
              onRename={(title) => onRename(thread.id, title)}
            />
          ))
        )}
      </div>
    </div>
  );
}
