import { useState } from 'react';
import { AgentChat } from '@inharness-ai/agent-chat';
import '@inharness-ai/agent-chat/styles';

function getInitialTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem('agent-chat-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  // Pick the architecture in the UI (config bar). Anything registered in
  // @inharness-ai/agent-adapters is available.
  //
  // `toolRenderers` defaults to the bundled `claudeCodeToolRenderers` — it
  // pretty-prints the built-in tool names that claude-code emits (Read, Edit,
  // Bash, Grep, …). For other adapters whose tool names don't match, blocks
  // fall back to a generic JSON view. To register custom renderers (e.g. for
  // MCP tools), import `claudeCodeToolRenderers` and pass:
  //
  //   toolRenderers={{
  //     ...claudeCodeToolRenderers,
  //     'mcp__my-server__lookup': { summary: (i) => `lookup ${(i as any).id}` },
  //   }}

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
      batchTools
    />
  );
}
