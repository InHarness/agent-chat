<!-- anchor: a4drp001 -->
# Frontend — drop-in mode

The fastest path: one component, full chat. `<AgentChat />` composes
`useAgentChat` with the bundled UI (config bar, thread list, message list,
input area, optional usage footer) and wires the `ToolRendererProvider` and
`UserInputResponderProvider` for you.

<!-- anchor: a4drp002 -->
## Minimal usage

```tsx
import { AgentChat } from '@inharness-ai/agent-chat';
import '@inharness-ai/agent-chat/styles';

export function App() {
  return <AgentChat serverUrl="http://localhost:3001" />;
}
```

That's all you need. The component fetches `GET /api/config`, builds a
config bar, lists threads from `GET /api/threads`, and starts a turn by
`POST /api/chat` — sending a <inline_mention type="dto" slug="chat-request"/>.

<!-- anchor: a4drp003 -->
## Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `serverUrl` | `string` | — | Base URL of the Express server. Required. |
| `theme` | `'light' \| 'dark'` | `'light'` | Sets `data-ac-theme` on the root. |
| `onThemeChange` | `(theme) => void` | — | If provided, renders a theme-toggle button. |
| `className` | `string` | — | Forwarded to the root element. |
| `showConfigBar` | `boolean` | `true` | Architecture/model dropdowns + advanced drawer. |
| `showThreadList` | `boolean` | `true` | Sidebar with thread CRUD. |
| `showUsage` | `boolean` | `false` | `<UsageDisplay />` footer — context window utilization bar (`contextSize / contextWindow`). |
| `batchTools` | `boolean` | `false` | Collapse runs of same-category tools into a `ToolBatchBlock`. |
| `toolRenderers` | `ToolRendererRegistry` | `claudeCodeToolRenderers` | Override how individual tool calls render. See `08-tool-renderers.md`. |

<!-- anchor: a4drp004 -->
## Example with theme persistence

```tsx
import { useState } from 'react';
import { AgentChat } from '@inharness-ai/agent-chat';
import '@inharness-ai/agent-chat/styles';

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
      batchTools
    />
  );
}
```

This is the example shipped under `examples/basic/` — copy it as a
starting point.

<!-- anchor: a4drp005 -->
## What you give up

Drop-in mode locks the layout: sidebar on the left, config bar on top,
input pinned to the bottom. The advanced-options drawer toggles inline.
If you need a different shell — say a sidebar on the right, a hidden
config bar with command-palette routing, or chat embedded inside another
panel — switch to hooks mode (`05-frontend-hooks.md`). You can keep the
individual components from `agent-chat` and skip only the outer
`<AgentChat />`.

<!-- anchor: a4drp006 -->
## Customisation hatches

You don't have to leave drop-in mode for these:

- **CSS variables** — restyle anything visual. See `06-theming.md`.
- **`toolRenderers`** — change how a specific tool name renders without
  forking. Useful for MCP tools (`mcp__my-server__lookup`) or for adapters
  whose tool names don't match the bundled `claudeCodeToolRenderers`. Full
  recipe in `08-tool-renderers.md`.

For anything else (custom block types, alternative input area, replacing
the thread list with your own data source), drop down to hooks.


<section_ref anchor="a8tlr001" relation="see_also"/>

<section_ref anchor="a6thm001" relation="see_also"/>

<section_ref anchor="a3bck001" relation="depends_on"/>