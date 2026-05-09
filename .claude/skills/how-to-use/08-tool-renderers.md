<!-- anchor: a8tlr001 -->
# Tool renderers & custom blocks

The single most common customisation: change how a specific tool call
renders without forking the kit. `<AgentChat />` and the bundled
`<ToolUseBlock />` look up a per-tool `ToolRenderer` from a registry
provided via React context.

<!-- anchor: a8tlr002 -->
## The default registry

The bundled `claudeCodeToolRenderers` covers the tool names Claude Code
emits (`Read`, `Edit`, `Bash`, `Grep`, `Glob`, `Task`, `TodoWrite`, …).
For any other tool name — including MCP tools whose names don't match —
the block falls back to a generic JSON view.

If your only adapter is `claude-code`, you don't need to do anything.
For other adapters (Codex, Gemini, OpenCode) the fallback view is fine
out of the box but ugly; ship custom renderers when you want polish.

<!-- anchor: a8tlr003 -->
## The `ToolRenderer` shape

```ts
interface ToolRenderer {
  summary(input: unknown, result?: unknown): string;
  renderInput?(input: unknown): ReactNode;
  renderResult?(result: unknown): ReactNode;
}

type ToolRendererRegistry = Record<string, ToolRenderer>;
```

- **`summary(input, result?)`** — the one-line label shown on the
  collapsed tool card. Required. Receives the raw `input` from the
  <inline_mention type="dto" slug="wire-content-block"/> and, if the
  result has arrived, the result payload.
- **`renderInput(input)`** *(optional)* — custom React for the expanded
  input panel. If omitted, falls back to a JSON view.
- **`renderResult(result)`** *(optional)* — custom React for the
  expanded result panel. If omitted, falls back to a JSON view.

The persisted shape on disk is
<inline_mention type="dto" slug="stored-content-block"/> — same fields,
slightly different enums for non-streaming variants.

<!-- anchor: a8tlr004 -->
## Registering custom renderers (drop-in)

Pass a registry to `<AgentChat toolRenderers={…} />`. Spread the
defaults if you want to keep them:

```tsx
import { AgentChat, claudeCodeToolRenderers } from '@inharness-ai/agent-chat';

<AgentChat
  serverUrl="http://localhost:3001"
  toolRenderers={{
    ...claudeCodeToolRenderers,
    'mcp__my-server__lookup': {
      summary: (input) => `lookup ${(input as any).id}`,
      renderResult: (result) => <pre>{(result as any).text}</pre>,
    },
  }}
/>
```

Without the spread, `<AgentChat>` swaps the entire registry — Claude Code
tool names will fall back to the JSON view.

<!-- anchor: a8tlr005 -->
## Registering custom renderers (hooks)

`<AgentChat />` wraps the tree with `<ToolRendererProvider>`. In hooks
mode you do the same:

```tsx
import {
  ToolRendererProvider,
  claudeCodeToolRenderers,
  useAgentChat,
} from '@inharness-ai/agent-chat';

const myRegistry = {
  ...claudeCodeToolRenderers,
  'mcp__my-server__lookup': { summary: (i) => `lookup ${(i as any).id}` },
};

function MyChat() {
  const chat = useAgentChat({ serverUrl: '...' });
  return (
    <ToolRendererProvider registry={myRegistry}>
      {/* your layout, including <AssistantContent /> or your own walker */}
    </ToolRendererProvider>
  );
}
```

`useToolRenderer(toolName)` is exported from the same module if you're
writing a custom block component and need to look up the renderer
yourself.

<!-- anchor: a8tlr006 -->
## Custom block components

`<MessageList />` does **not** accept a components map. To swap a block
type wholesale (replace `<TextBlock />` with your own markdown renderer,
say), don't render `<AssistantContent />` — render your own walker over
`messages[].blocks`:

```tsx
{messages.map((msg) =>
  msg.role === 'user'
    ? <UserContent key={msg.id} message={msg} />
    : (
      <article key={msg.id} data-role="assistant">
        {msg.blocks.map((block, i) => {
          switch (block.type) {
            case 'text':       return <MyMarkdown key={i} text={block.text} />;
            case 'thinking':   return <ThinkingBlock key={i} block={block} />;
            case 'tool_use':   return <ToolUseBlock key={i} block={block} />;
            case 'tool_result':return <ToolResultBlock key={i} block={block} />;
            // etc.
          }
        })}
      </article>
    )
)}
```

Mix bundled and custom blocks freely. The block shapes match
<inline_mention type="dto" slug="stored-content-block"/> on persisted
messages and <inline_mention type="dto" slug="wire-content-block"/>
during streaming. Use `useToolRenderer` to keep your custom
`tool_use` view consistent with the registry.

<single_element type="dto" slug="stored-content-block"/>


<section_ref anchor="a5hks001" relation="see_also"/>

<section_ref anchor="a4drp001" relation="depends_on"/>