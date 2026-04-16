import React from 'react';
import type { ChatMessage as ChatMessageType } from '../types.js';
import { ChatMessage } from './ChatMessage.js';

interface MessageListProps {
  messages: ChatMessageType[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div data-ac="message-list">
      {messages.map(msg => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
    </div>
  );
}
