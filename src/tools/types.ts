import type { ReactNode } from 'react';

export interface ToolRenderer {
  summary(input: unknown, result?: unknown): string;
  renderInput?(input: unknown): ReactNode;
  renderResult?(result: unknown): ReactNode;
}

export type ToolRendererRegistry = Record<string, ToolRenderer>;
