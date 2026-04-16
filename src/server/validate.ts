import type { ChatRequest } from './protocol.js';

export interface ValidationError {
  field: string;
  message: string;
}

const MAX_PROMPT_LENGTH = 100_000;

export function validateChatRequest(body: unknown, validArchitectures: string[]): { ok: true; data: ChatRequest } | { ok: false; errors: ValidationError[] } {
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }

  const errors: ValidationError[] = [];
  const b = body as Record<string, unknown>;

  // prompt — required non-empty string
  if (typeof b.prompt !== 'string' || b.prompt.trim().length === 0) {
    errors.push({ field: 'prompt', message: 'prompt is required and must be a non-empty string' });
  } else if (b.prompt.length > MAX_PROMPT_LENGTH) {
    errors.push({ field: 'prompt', message: `prompt must be under ${MAX_PROMPT_LENGTH} characters` });
  }

  // architecture — optional, must be valid
  if (b.architecture !== undefined) {
    if (typeof b.architecture !== 'string' || !validArchitectures.includes(b.architecture)) {
      errors.push({ field: 'architecture', message: `architecture must be one of: ${validArchitectures.join(', ')}` });
    }
  }

  // model — optional string
  if (b.model !== undefined && typeof b.model !== 'string') {
    errors.push({ field: 'model', message: 'model must be a string' });
  }

  // threadId — optional string
  if (b.threadId !== undefined && typeof b.threadId !== 'string') {
    errors.push({ field: 'threadId', message: 'threadId must be a string' });
  }

  // sessionId — optional string
  if (b.sessionId !== undefined && typeof b.sessionId !== 'string') {
    errors.push({ field: 'sessionId', message: 'sessionId must be a string' });
  }

  // cwd — optional string
  if (b.cwd !== undefined && typeof b.cwd !== 'string') {
    errors.push({ field: 'cwd', message: 'cwd must be a string' });
  }

  // maxTurns — optional positive integer
  if (b.maxTurns !== undefined && (typeof b.maxTurns !== 'number' || b.maxTurns < 1)) {
    errors.push({ field: 'maxTurns', message: 'maxTurns must be a positive number' });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      prompt: (b.prompt as string).trim(),
      threadId: b.threadId as string | undefined,
      architecture: b.architecture as string | undefined,
      model: b.model as string | undefined,
      systemPrompt: b.systemPrompt as string | undefined,
      sessionId: b.sessionId as string | undefined,
      maxTurns: b.maxTurns as number | undefined,
      allowedTools: b.allowedTools as string[] | undefined,
      architectureConfig: b.architectureConfig as Record<string, unknown> | undefined,
      cwd: b.cwd as string | undefined,
    },
  };
}
