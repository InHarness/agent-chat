import React, { useRef, useEffect } from 'react';
import type { ChatMessage, TodoItem } from '../types.js';
import { MessageList } from './MessageList.js';
import { CurrentTodoList } from './CurrentTodoList.js';

interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  batchTools?: boolean;
  currentTodoItems?: TodoItem[] | null;
}

export function ChatContainer({ messages, isStreaming, batchTools, currentTodoItems }: ChatContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom || isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  return (
    <div data-ac="chat-container" ref={scrollRef}>
      <CurrentTodoList items={currentTodoItems ?? null} />
      {messages.length === 0 ? (
        <div data-ac="empty-state">
          Start a conversation
        </div>
      ) : (
        <MessageList messages={messages} batchTools={batchTools} />
      )}
    </div>
  );
}
