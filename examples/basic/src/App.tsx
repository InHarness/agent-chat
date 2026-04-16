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
    <div style={{ position: 'relative', height: '100vh' }}>
      <button
        onClick={() => setTheme(t => {
          const next = t === 'dark' ? 'light' : 'dark';
          localStorage.setItem('agent-chat-theme', next);
          return next;
        })}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 10,
          padding: '4px 12px',
          borderRadius: 6,
          border: '1px solid #888',
          background: theme === 'dark' ? '#333' : '#eee',
          color: theme === 'dark' ? '#fff' : '#000',
          cursor: 'pointer',
        }}
      >
        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
      </button>
      <AgentChat
        serverUrl="http://localhost:3001"
        theme={theme}
        showConfigBar={true}
        showThreadList={true}
        showUsage={true}
      />
    </div>
  );
}
