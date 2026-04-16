import React from 'react';
import type { AgentChatProps } from '../types.js';
import { useAgentChat } from '../hooks/useAgentChat.js';
import { ChatContainer } from './ChatContainer.js';
import { InputArea } from './InputArea.js';
import { ConfigBar } from './ConfigBar.js';
import { ThreadList } from './ThreadList.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { UsageDisplay } from './UsageDisplay.js';

export function AgentChat({
  serverUrl,
  theme = 'light',
  className,
  showConfigBar = true,
  showThreadList = true,
  showUsage = false,
}: AgentChatProps) {
  const chat = useAgentChat({ serverUrl });

  return (
    <div
      data-ac="chat"
      data-ac-theme={theme}
      className={className}
    >
      {showThreadList && (
        <ThreadList
          threads={chat.threads}
          activeThreadId={chat.activeThreadId}
          onSelect={chat.loadThread}
          onDelete={chat.deleteThread}
          onRename={chat.renameThread}
          onNewThread={chat.createThread}
        />
      )}
      <div data-ac="chat-main">
        {showConfigBar && (
          <ConfigBar
            config={chat.config}
            architecture={chat.architecture}
            model={chat.model}
            onArchitectureChange={chat.setArchitecture}
            onModelChange={chat.setModel}
            disabled={chat.isStreaming}
          />
        )}
        <ChatContainer
          messages={chat.messages}
          isStreaming={chat.isStreaming}
        />
        {chat.error && <ErrorDisplay error={chat.error} />}
        <InputArea
          onSend={chat.sendMessage}
          onAbort={chat.abort}
          isStreaming={chat.isStreaming}
          disabled={chat.configLoading}
        />
        {showUsage && chat.usage && <UsageDisplay usage={chat.usage} />}
      </div>
    </div>
  );
}
