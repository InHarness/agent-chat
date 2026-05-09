<!-- anchor: a6thm001 -->
# Theming

The kit ships plain CSS keyed off custom properties. There is no runtime
theming engine — set CSS variables, target `data-ac-*` attributes, done.
This is the same path used by both the drop-in component and the hooks.

<!-- anchor: a6thm002 -->
## Light vs dark

Set `theme="light"` or `theme="dark"` on `<AgentChat />` to flip
`data-ac-theme` on the root. Variables are scoped per theme inside
`variables.css`. To wire a toggle, pass `onThemeChange`:

```tsx
<AgentChat
  serverUrl="..."
  theme={theme}
  onThemeChange={setTheme}
/>
```

In hooks mode, set the attribute yourself:

```tsx
<div data-ac-theme={theme}>{/* your tree */}</div>
```

<!-- anchor: a6thm003 -->
## Common variables

Override `--ac-*` at any level. Most-touched ones:

| Variable | Default (light) | Description |
|---|---|---|
| `--ac-chat-max-width` | `900px` | Max width of chat area |
| `--ac-chat-height` | `100vh` | Height of chat container |
| `--ac-sidebar-width` | `280px` | Thread list sidebar width |
| `--ac-bg-primary` | `#ffffff` | Main background |
| `--ac-bg-assistant` | `#f4f4f6` | Assistant message background |
| `--ac-bg-user` | `#e8e0ff` | User message background |
| `--ac-bg-tool` | `#f5f3ff` | Tool card background |
| `--ac-bg-thinking` | `#fffbeb` | Thinking block background |
| `--ac-bg-code` | `#1e1e2e` | Code block background |
| `--ac-accent` | `#7c3aed` | Primary accent |
| `--ac-font-family` | `system-ui, …` | Base font |
| `--ac-font-mono` | `SF Mono, …` | Code font |
| `--ac-border-radius` | `8px` | Border radius |

The full set (50+) lives in `variables.css` — read it directly when you
need a variable not listed here. Treat the table as the curated subset
people actually override.

<!-- anchor: a6thm004 -->
## Targeting components

Every component sets a `data-ac` attribute. Use them as stable selectors;
class names are not part of the public API.

```css
/* Accent recolour */
:root {
  --ac-accent: #2563eb;
  --ac-accent-hover: #1d4ed8;
}

/* Custom assistant message background */
[data-ac="message"][data-role="assistant"] {
  background: #f0f9ff;
}

/* Hide thinking blocks entirely */
[data-ac="thinking"] {
  display: none;
}

/* Wider chat area */
:root {
  --ac-chat-max-width: 1200px;
}
```

`data-ac` values match component names (`message`, `tool-use`,
`thinking`, `text`, `code`, `thread-list`, `input`, …). Combine with
`data-role` (`user`/`assistant`), `data-tool-name`, `data-ac-theme` etc.
for finer targeting.

<!-- anchor: a6thm005 -->
## Scoping per surface

If you embed the chat inside a larger app, scope overrides under a wrapper
instead of `:root`:

```css
.my-chat-shell {
  --ac-chat-max-width: 100%;
  --ac-bg-primary: transparent;
}
```

```tsx
<div className="my-chat-shell">
  <AgentChat serverUrl="..." />
</div>
```

This keeps the rest of your app untouched and lets you ship multiple chat
surfaces with different looks side-by-side.
