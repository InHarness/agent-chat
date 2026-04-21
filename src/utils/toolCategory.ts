export type ToolCategory = 'edit' | 'read' | 'search' | 'shell' | 'task' | 'other';

const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',

  Read: 'read',
  NotebookRead: 'read',

  Glob: 'search',
  Grep: 'search',
  WebSearch: 'search',
  WebFetch: 'search',

  Bash: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',

  Task: 'task',
  Agent: 'task',
};

export function toolCategory(toolName: string): ToolCategory {
  return CATEGORY_BY_TOOL[toolName] ?? 'other';
}

/**
 * Key used to decide whether two consecutive tool calls belong in the same batch.
 * Known categories group across tool names; 'other' groups only identical tool names.
 */
export function groupingKey(toolName: string): string {
  const cat = toolCategory(toolName);
  return cat === 'other' ? `other:${toolName}` : cat;
}

export function categoryLabel(category: ToolCategory, count: number, fallbackToolName?: string): string {
  switch (category) {
    case 'edit':
      return `Edited ${count} ${count === 1 ? 'file' : 'files'}`;
    case 'read':
      return `Read ${count} ${count === 1 ? 'file' : 'files'}`;
    case 'search':
      return `Ran ${count} ${count === 1 ? 'search' : 'searches'}`;
    case 'shell':
      return `Ran ${count} ${count === 1 ? 'command' : 'commands'}`;
    case 'task':
      return `Ran ${count} ${count === 1 ? 'subtask' : 'subtasks'}`;
    case 'other':
      return `${fallbackToolName ?? 'Tool'} × ${count}`;
  }
}
