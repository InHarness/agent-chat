import { useState } from 'react';
import { AgentChat } from '@inharness/agent-chat';
import '@inharness/agent-chat/styles';

function getInitialTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem('agent-chat-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  return (
    <AgentChat
      serverUrl="http://localhost:3001"
      theme={theme}
      onThemeChange={(next) => {
        setTheme(next);
        localStorage.setItem('agent-chat-theme', next);
      }}
      showConfigBar
      showThreadList
      showUsage
    />
  );
}
