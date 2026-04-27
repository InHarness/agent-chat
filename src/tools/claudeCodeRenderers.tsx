import React from 'react';
import type { ToolRenderer, ToolRendererRegistry } from './types.js';
import { clip, cx, cx2, kv, mono } from './helpers.js';

const Read: ToolRenderer = {
  summary(i) {
    const path = cx(i).input.file_path ?? cx(i).input.path;
    return path ? `Read ${path}` : 'Read file';
  },
  renderInput(i) {
    const { file_path, offset, limit, path } = cx(i).input;
    return (
      <div data-ac="tool-kv-group">
        {kv('Path', mono(String(file_path ?? path ?? '?')))}
        {typeof offset === 'number' ? kv('Offset', mono(String(offset))) : null}
        {typeof limit === 'number' ? kv('Limit', mono(String(limit))) : null}
      </div>
    );
  },
  renderResult(r) {
    const text = typeof r === 'string' ? r : null;
    if (!text) return null;
    const lines = text.split('\n');
    return (
      <div data-ac="tool-meta">
        {lines.length} line{lines.length === 1 ? '' : 's'}, {text.length} chars
      </div>
    );
  },
};

const Write: ToolRenderer = {
  summary(i) {
    const path = cx(i).input.file_path ?? cx(i).input.path;
    return path ? `Write ${path}` : 'Write file';
  },
  renderInput(i) {
    const { file_path, content } = cx(i).input;
    const text = typeof content === 'string' ? content : '';
    const lines = text.split('\n').length;
    return (
      <div data-ac="tool-kv-group">
        {kv('Path', mono(String(file_path ?? '?')))}
        {kv('Size', mono(`${lines} lines · ${text.length} chars`))}
      </div>
    );
  },
};

const Edit: ToolRenderer = {
  summary(i) {
    const path = cx(i).input.file_path ?? cx(i).input.path;
    return path ? `Edit ${path}` : 'Edit file';
  },
  renderInput(i) {
    const { file_path, old_string, new_string, replace_all } = cx(i).input;
    const oldText = typeof old_string === 'string' ? old_string : '';
    const newText = typeof new_string === 'string' ? new_string : '';
    return (
      <div data-ac="tool-kv-group">
        {kv('Path', mono(String(file_path ?? '?')))}
        {replace_all ? kv('Mode', 'replace_all') : null}
        {kv(
          'Diff',
          <div data-ac="tool-diff">
            <pre data-ac="tool-diff-del">{clip(oldText, 500)}</pre>
            <pre data-ac="tool-diff-add">{clip(newText, 500)}</pre>
          </div>,
        )}
      </div>
    );
  },
};

const MultiEdit: ToolRenderer = {
  summary(i) {
    const { file_path, edits } = cx(i).input;
    const count = Array.isArray(edits) ? (edits as unknown[]).length : undefined;
    const base = file_path ? `Edit ${file_path}` : 'Multi-edit';
    return typeof count === 'number' ? `${base} (${count} edits)` : base;
  },
};

const Glob: ToolRenderer = {
  summary(i) {
    return `Find: ${cx(i).input.pattern ?? '?'}`;
  },
  renderInput(i) {
    const { pattern, path } = cx(i).input;
    return (
      <div data-ac="tool-kv-group">
        {kv('Pattern', mono(String(pattern ?? '?')))}
        {path ? kv('Path', mono(String(path))) : null}
      </div>
    );
  },
  renderResult(r) {
    const text = typeof r === 'string' ? r : null;
    if (!text) return null;
    const lines = text.split('\n').filter(Boolean);
    return (
      <div data-ac="tool-list">
        <div data-ac="tool-meta">
          {lines.length} match{lines.length === 1 ? '' : 'es'}
        </div>
        {lines.slice(0, 8).map((ln, idx) => (
          <div key={idx} data-ac="tool-list-item">
            {ln}
          </div>
        ))}
        {lines.length > 8 && <div data-ac="tool-meta">… +{lines.length - 8} more</div>}
      </div>
    );
  },
};

const Grep: ToolRenderer = {
  summary(i) {
    const { pattern, path } = cx(i).input;
    return `Search "${pattern ?? '?'}"${path ? ` in ${path}` : ''}`;
  },
  renderInput(i) {
    const { pattern, path, glob, type, output_mode } = cx(i).input;
    return (
      <div data-ac="tool-kv-group">
        {kv('Pattern', mono(String(pattern ?? '?')))}
        {path ? kv('Path', mono(String(path))) : null}
        {glob ? kv('Glob', mono(String(glob))) : null}
        {type ? kv('Type', mono(String(type))) : null}
        {output_mode ? kv('Mode', mono(String(output_mode))) : null}
      </div>
    );
  },
  renderResult(r) {
    const text = typeof r === 'string' ? r : null;
    if (!text) return null;
    const lines = text.split('\n').filter(Boolean);
    return (
      <div data-ac="tool-list">
        <div data-ac="tool-meta">
          {lines.length} line{lines.length === 1 ? '' : 's'}
        </div>
        {lines.slice(0, 8).map((ln, idx) => (
          <div key={idx} data-ac="tool-list-item">
            {ln}
          </div>
        ))}
        {lines.length > 8 && <div data-ac="tool-meta">… +{lines.length - 8} more</div>}
      </div>
    );
  },
};

const Bash: ToolRenderer = {
  summary(i) {
    const cmd = cx(i).input.command;
    if (typeof cmd !== 'string') return 'Run shell command';
    const short = cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd;
    return `$ ${short}`;
  },
  renderInput(i) {
    const { command, description } = cx(i).input;
    return (
      <div data-ac="tool-kv-group">
        {description ? kv('What', String(description)) : null}
        {kv('Command', <pre data-ac="tool-terminal">{String(command ?? '?')}</pre>)}
      </div>
    );
  },
  renderResult(r) {
    const text = typeof r === 'string' ? r : null;
    if (!text) return null;
    return <pre data-ac="tool-terminal tool-terminal-result">{clip(text, 2000)}</pre>;
  },
};

const WebFetch: ToolRenderer = {
  summary(i) {
    const url = cx(i).input.url;
    return typeof url === 'string' ? `Fetch ${url}` : 'Fetch URL';
  },
  renderInput(i) {
    const { url, prompt } = cx(i).input;
    return (
      <div data-ac="tool-kv-group">
        {url ? kv('URL', mono(String(url))) : null}
        {prompt ? kv('Prompt', String(prompt)) : null}
      </div>
    );
  },
};

const WebSearch: ToolRenderer = {
  summary(i) {
    const query = cx(i).input.query;
    return typeof query === 'string' ? `Search web: "${query}"` : 'Web search';
  },
};

const Task: ToolRenderer = {
  summary(i) {
    const { description, subagent_type } = cx(i).input;
    const base = typeof description === 'string' ? description : 'Subagent task';
    return subagent_type ? `${base} (${subagent_type})` : base;
  },
  renderInput(i) {
    const { description, prompt, subagent_type } = cx(i).input;
    return (
      <div data-ac="tool-kv-group">
        {description ? kv('Description', String(description)) : null}
        {subagent_type ? kv('Subagent', mono(String(subagent_type))) : null}
        {prompt ? kv('Prompt', String(prompt)) : null}
      </div>
    );
  },
};

const TodoWrite: ToolRenderer = {
  summary(i) {
    const todos = cx(i).input.todos;
    const count = Array.isArray(todos) ? (todos as unknown[]).length : undefined;
    return typeof count === 'number' ? `Update todos (${count})` : 'Update todos';
  },
};

const NotebookEdit: ToolRenderer = {
  summary(i) {
    const path = cx(i).input.notebook_path ?? cx(i).input.file_path;
    return path ? `Edit notebook ${path}` : 'Edit notebook';
  },
};

export const claudeCodeToolRenderers: ToolRendererRegistry = {
  Read,
  Write,
  Edit,
  MultiEdit,
  Glob,
  Grep,
  Bash,
  WebFetch,
  WebSearch,
  Task,
  TodoWrite,
  NotebookEdit,
};
