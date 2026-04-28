import { useState } from 'react';
import { AgentChat } from '../../index.js';
import '../../styles/index.css';

function getInitialTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem('agent-chat-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  return (
    <AgentChat
      serverUrl=""
      theme={theme}
      onThemeChange={(next) => {
        setTheme(next);
        localStorage.setItem('agent-chat-theme', next);
      }}
      showConfigBar
      showThreadList
      showUsage
      batchTools
    />
  );
}
