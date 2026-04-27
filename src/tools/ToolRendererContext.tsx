import React, { createContext, useContext } from 'react';
import type { ToolRenderer, ToolRendererRegistry } from './types.js';
import { claudeCodeToolRenderers } from './claudeCodeRenderers.js';

const ToolRendererContext = createContext<ToolRendererRegistry>(claudeCodeToolRenderers);

export function ToolRendererProvider({
  registry,
  children,
}: {
  registry?: ToolRendererRegistry;
  children: React.ReactNode;
}) {
  return (
    <ToolRendererContext.Provider value={registry ?? claudeCodeToolRenderers}>
      {children}
    </ToolRendererContext.Provider>
  );
}

export function useToolRenderer(toolName: string): ToolRenderer | null {
  const registry = useContext(ToolRendererContext);
  return registry[toolName] ?? null;
}
