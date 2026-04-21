import React, { useEffect, useState } from 'react';
import type { AgentChatProps } from '../types.js';
import { useAgentChat } from '../hooks/useAgentChat.js';
import { ChatContainer } from './ChatContainer.js';
import { InputArea } from './InputArea.js';
import { ConfigBar } from './ConfigBar.js';
import { AdvancedOptions } from './AdvancedOptions.js';
import { ThreadList } from './ThreadList.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { UsageDisplay } from './UsageDisplay.js';
import { ContextWindowContext } from './ContextWindowContext.js';

const SIDEBAR_STORAGE_KEY = 'agent-chat-sidebar-open';
const ADVANCED_STORAGE_KEY = 'agent-chat-advanced-open';

function readStoredFlag(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {
    // ignore
  }
  return fallback;
}

export function AgentChat({
  serverUrl,
  theme = 'light',
  onThemeChange,
  className,
  showConfigBar = true,
  showThreadList = true,
  showUsage = false,
  batchTools = false,
}: AgentChatProps) {
  const chat = useAgentChat({ serverUrl });
  const [sidebarOpen, setSidebarOpen] = useState(() => readStoredFlag(SIDEBAR_STORAGE_KEY, true));
  const [advancedOpen, setAdvancedOpen] = useState(() => readStoredFlag(ADVANCED_STORAGE_KEY, false));

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen));
    } catch {
      // ignore
    }
  }, [sidebarOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADVANCED_STORAGE_KEY, String(advancedOpen));
    } catch {
      // ignore
    }
  }, [advancedOpen]);

  return (
    <ContextWindowContext.Provider value={chat.contextWindow}>
    <div
      data-ac="chat"
      data-ac-theme={theme}
      className={className}
    >
      {showThreadList && (
        <>
          <ThreadList
            threads={chat.threads}
            activeThreadId={chat.activeThreadId}
            onSelect={chat.loadThread}
            onDelete={chat.deleteThread}
            onRename={chat.renameThread}
            onNewThread={chat.createThread}
            onClose={() => setSidebarOpen(false)}
            collapsed={!sidebarOpen}
          />
          {!sidebarOpen && (
            <button
              data-ac="sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              type="button"
              aria-label="Show conversations"
              aria-expanded={false}
              title="Show conversations"
            >
              {'\u2630'}
            </button>
          )}
        </>
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
          batchTools={batchTools}
          currentTodoItems={chat.currentTodoItems}
        />
        {chat.error && <ErrorDisplay error={chat.error} />}
        <InputArea
          onSend={chat.sendMessage}
          onAbort={chat.abort}
          isStreaming={chat.isStreaming}
          disabled={chat.configLoading}
          planMode={chat.planMode}
          onPlanModeChange={chat.setPlanMode}
        />
        {showUsage && chat.usage && <UsageDisplay usage={chat.usage} contextWindow={chat.contextWindow} />}
      </div>
      {showConfigBar && (
        <>
          {onThemeChange && (
            <button
              data-ac="theme-toggle"
              data-ac-advanced-open={advancedOpen ? 'true' : 'false'}
              onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? '\u263C' : '\u263D'}
            </button>
          )}
          <button
            data-ac="advanced-toggle"
            data-ac-open={advancedOpen ? 'true' : 'false'}
            onClick={() => setAdvancedOpen(v => !v)}
            type="button"
            aria-label={advancedOpen ? 'Hide advanced options' : 'Show advanced options'}
            aria-expanded={advancedOpen}
            title={advancedOpen ? 'Hide advanced options' : 'Show advanced options'}
          >
            {'\u2699'}
          </button>
          <AdvancedOptions
            cwd={chat.cwd}
            onCwdChange={chat.setCwd}
            defaultCwd={chat.defaultCwd}
            activeCwd={chat.activeCwd}
            systemPrompt={chat.systemPrompt}
            onSystemPromptChange={chat.setSystemPrompt}
            maxTurns={chat.maxTurns}
            onMaxTurnsChange={chat.setMaxTurns}
            options={chat.architectureOptions}
            architectureConfig={chat.architectureConfig}
            onArchitectureConfigChange={chat.setArchitectureConfig}
            model={chat.model}
            disabled={chat.isStreaming}
            open={advancedOpen}
            onClose={() => setAdvancedOpen(false)}
          />
        </>
      )}
    </div>
    </ContextWindowContext.Provider>
  );
}
