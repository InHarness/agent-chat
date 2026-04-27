import React, { useState } from 'react';
import type { ChatMessage, UsageStats } from '../types.js';
import { AssistantContent } from './AssistantContent.js';
import { useContextWindow } from './ContextWindowContext.js';
import { totalContextTokens, contextLevel } from './UsageDisplay.js';
import { useToolRenderer } from '../tools/ToolRendererContext.js';
import { parseToolResult, prettyToolName } from '../tools/helpers.js';
import { ToolJsonModal } from '../tools/ToolJsonModal.js';

interface ToolUseResult {
  content: string;
  isError: boolean;
  collapsed: boolean;
}

interface ToolUseSubagent {
  description: string;
  status: string;
  summary?: string;
  messages: ChatMessage[];
  usage?: UsageStats;
}

interface ToolUseBlockProps {
  toolName: string;
  toolUseId: string;
  input: unknown;
  defaultCollapsed?: boolean;
  result?: ToolUseResult;
  subagent?: ToolUseSubagent;
}

function extractDescription(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const desc = (input as Record<string, unknown>).description;
  if (typeof desc !== 'string') return null;
  const trimmed = desc.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ToolUseBlock({ toolName, input, defaultCollapsed = true, result, subagent }: ToolUseBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [jsonOpen, setJsonOpen] = useState(false);
  const contextWindow = useContextWindow();
  const renderer = useToolRenderer(toolName);

  const icon = subagent
    ? (subagent.status === 'running' ? '⟳' : subagent.status === 'completed' ? '✓' : '✕')
    : result
      ? (result.isError ? '✕' : '✓')
      : '⟳';

  const description = subagent ? null : extractDescription(input);

  const subagentCtx = subagent?.usage && contextWindow
    ? (() => {
        const total = totalContextTokens(subagent.usage);
        const pct = Math.min(100, (total / contextWindow) * 100);
        return { pct, level: contextLevel(pct) };
      })()
    : null;

  const parsedResult = result ? parseToolResult(result.content) : null;
  const hasCustomInput = !subagent && typeof renderer?.renderInput === 'function';
  const hasCustomResult = !subagent && typeof renderer?.renderResult === 'function' && parsedResult !== null;
  const summaryLabel = subagent
    ? subagent.description
    : renderer?.summary(input, parsedResult) ?? prettyToolName(toolName);

  return (
    <>
      <div data-ac="tool-call" data-collapsed={collapsed || undefined} data-has-result={!!result || undefined} data-has-subagent={!!subagent || undefined}>
        <div data-ac="tool-use-header">
          <button
            data-ac="tool-use-toggle"
            onClick={() => setCollapsed(!collapsed)}
            type="button"
          >
            <span data-ac="tool-use-icon">{icon}</span>
            <span data-ac="tool-use-name">{summaryLabel}</span>
            {description && <span data-ac="tool-use-description">{description}</span>}
            {subagentCtx && (
              <span data-ac="subagent-ctx-badge" data-level={subagentCtx.level} title="Subagent context window usage">
                ctx {subagentCtx.pct.toFixed(0)}%
              </span>
            )}
            <span data-ac="toggle-arrow">{collapsed ? '▸' : '▾'}</span>
          </button>
          {!subagent && (
            <button
              data-ac="tool-json-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setJsonOpen(true);
              }}
              aria-label="Show raw JSON"
              title="Show raw JSON"
            >
              {'{}'}
            </button>
          )}
        </div>
        {!collapsed && (
          <div data-ac="tool-call-body">
            {hasCustomInput || hasCustomResult ? (
              <>
                {hasCustomInput && (
                  <div data-ac="tool-detail" data-section="input">
                    <div data-ac="tool-detail-label">Input</div>
                    {renderer!.renderInput!(input)}
                  </div>
                )}
                {hasCustomResult && (
                  <div data-ac="tool-detail" data-section={result?.isError ? 'error' : 'result'}>
                    <div data-ac="tool-detail-label" data-error={result?.isError || undefined}>
                      {result?.isError ? 'Error' : 'Result'}
                    </div>
                    {renderer!.renderResult!(parsedResult)}
                  </div>
                )}
              </>
            ) : (
              !subagent && (
                <pre data-ac="tool-use-input">
                  {JSON.stringify(input, null, 2)}
                </pre>
              )
            )}
            {subagent && (
              <div data-ac="subagent-content">
                {subagent.messages.map(msg => (
                  msg.role === 'assistant' && (
                    <AssistantContent key={msg.id} blocks={msg.blocks} />
                  )
                ))}
                {subagent.summary && <div data-ac="subagent-summary">{subagent.summary}</div>}
              </div>
            )}
            {result && !hasCustomResult && (
              <pre data-ac="tool-result-content" data-error={result.isError || undefined}>
                {result.content}
              </pre>
            )}
          </div>
        )}
      </div>
      {jsonOpen && (
        <ToolJsonModal
          toolName={toolName}
          input={input}
          result={parsedResult}
          isError={result?.isError}
          onClose={() => setJsonOpen(false)}
        />
      )}
    </>
  );
}
