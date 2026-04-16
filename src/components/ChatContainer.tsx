import React, { useRef, useEffect } from 'react';
import type { ChatMessage } from '../types.js';
import { MessageList } from './MessageList.js';

interface ChatContainerProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export function ChatContainer({ messages, isStreaming }: ChatContainerProps) {
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
      {messages.length === 0 ? (
        <div data-ac="empty-state">
          Start a conversation
        </div>
      ) : (
        <MessageList messages={messages} />
      )}
    </div>
  );
}
