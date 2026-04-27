import React, { type ReactNode } from 'react';

export function prettyToolName(full: string): string {
  return full.startsWith('mcp__') ? (full.split('__').slice(-1)[0] ?? full) : full;
}

// Adapters serialize MCP tool results as a JSON-encoded content array:
//   [{"type":"text","text":"<tool payload JSON>"}]
// Built-in tool results arrive as plain strings. Try both layers before falling back.
export function parseToolResult(raw: string): unknown {
  if (!raw) return null;
  try {
    const outer = JSON.parse(raw);
    if (Array.isArray(outer) && outer[0]?.type === 'text' && typeof outer[0].text === 'string') {
      try {
        return JSON.parse(outer[0].text);
      } catch {
        return outer[0].text;
      }
    }
    return outer;
  } catch {
    return raw;
  }
}

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function kv(label: string, value: ReactNode): ReactNode {
  return (
    <div data-ac="tool-kv">
      <span data-ac="tool-kv-label">{label}</span>
      <span data-ac="tool-kv-value">{value}</span>
    </div>
  );
}

export function mono(value: ReactNode): ReactNode {
  return <span data-ac="tool-mono">{value}</span>;
}

interface Ctx {
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export function cx(input: unknown): Ctx {
  return { input: (input ?? {}) as Record<string, unknown>, result: null };
}

export function cx2(input: unknown, result: unknown): Ctx {
  return {
    input: (input ?? {}) as Record<string, unknown>,
    result: (result ?? {}) as Record<string, unknown>,
  };
}
