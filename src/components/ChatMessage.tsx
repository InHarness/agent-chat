import React from 'react';
import type { ChatMessage as ChatMessageType } from '../types.js';
import { AssistantContent } from './AssistantContent.js';
import { UserContent } from './UserContent.js';
import { LoadingIndicator } from './LoadingIndicator.js';

interface ChatMessageProps {
  message: ChatMessageType;
  batchTools?: boolean;
}

export function ChatMessage({ message, batchTools }: ChatMessageProps) {
  return (
    <div data-ac="message" data-role={message.role} data-streaming={message.isStreaming || undefined}>
      <div data-ac="message-avatar">
        {message.role === 'user' ? 'U' : 'A'}
      </div>
      <div data-ac="message-body">
        {message.role === 'user'
          ? <UserContent blocks={message.blocks} />
          : <AssistantContent blocks={message.blocks} batchTools={batchTools} />
        }
        {message.role === 'assistant' && message.isStreaming && message.blocks.length === 0 && (
          <LoadingIndicator />
        )}
      </div>
    </div>
  );
}
