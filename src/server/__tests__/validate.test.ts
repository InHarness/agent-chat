import { describe, expect, it } from 'vitest';
import { validateChatRequest } from '../validate.js';

const ARCHS = ['claude-code', 'codex', 'gemini'];

function expectError(
  result: ReturnType<typeof validateChatRequest>,
  field: string,
): void {
  if (result.ok) {
    throw new Error(`Expected validation failure for field "${field}", got ok`);
  }
  expect(result.errors.some(e => e.field === field)).toBe(true);
}

describe('validateChatRequest — body-level validation', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'a string'],
    ['number', 42],
  ] as const)('rejects body of type %s', (_label, body) => {
    const result = validateChatRequest(body, ARCHS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: 'body', message: 'Request body must be a JSON object' }]);
    }
  });

  // Arrays are `typeof === 'object'`, so the validator falls through to field-level
  // checks where `prompt` is missing. This documents current behaviour.
  it('treats arrays as objects and reports missing prompt', () => {
    const result = validateChatRequest([] as unknown, ARCHS);
    expectError(result, 'prompt');
  });
});

describe('validateChatRequest — prompt validation', () => {
  it('rejects missing prompt', () => {
    expectError(validateChatRequest({}, ARCHS), 'prompt');
  });

  it('rejects empty / whitespace-only prompt', () => {
    expectError(validateChatRequest({ prompt: '' }, ARCHS), 'prompt');
    expectError(validateChatRequest({ prompt: '   ' }, ARCHS), 'prompt');
  });

  it('rejects non-string prompt', () => {
    expectError(validateChatRequest({ prompt: 42 }, ARCHS), 'prompt');
  });

  it('rejects prompt exceeding the 100_000 char limit', () => {
    const tooLong = 'x'.repeat(100_001);
    const result = validateChatRequest({ prompt: tooLong }, ARCHS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const promptErr = result.errors.find(e => e.field === 'prompt');
      expect(promptErr?.message).toContain('100000');
    }
  });

  it('accepts a prompt at the exact 100_000 char limit', () => {
    const atLimit = 'x'.repeat(100_000);
    const result = validateChatRequest({ prompt: atLimit }, ARCHS);
    expect(result.ok).toBe(true);
  });

  it('trims surrounding whitespace from prompt on success', () => {
    const result = validateChatRequest({ prompt: '  hi  ' }, ARCHS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.prompt).toBe('hi');
  });
});

describe('validateChatRequest — architecture validation', () => {
  it('accepts a known architecture', () => {
    const result = validateChatRequest({ prompt: 'hi', architecture: 'claude-code' }, ARCHS);
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown architecture', () => {
    const result = validateChatRequest({ prompt: 'hi', architecture: 'mystery' }, ARCHS);
    expectError(result, 'architecture');
  });

  it('rejects a non-string architecture', () => {
    const result = validateChatRequest({ prompt: 'hi', architecture: 42 }, ARCHS);
    expectError(result, 'architecture');
  });

  it('lists valid architectures in the error message', () => {
    const result = validateChatRequest({ prompt: 'hi', architecture: 'mystery' }, ARCHS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(e => e.field === 'architecture');
      expect(err?.message).toContain('claude-code');
      expect(err?.message).toContain('codex');
      expect(err?.message).toContain('gemini');
    }
  });
});

describe('validateChatRequest — optional field type checks', () => {
  it.each([
    ['model', 123],
    ['threadId', {}],
    ['sessionId', []],
    ['cwd', null],
    ['planMode', 'true'],
  ] as const)('rejects %s with wrong type', (field, badValue) => {
    const result = validateChatRequest({ prompt: 'hi', [field]: badValue }, ARCHS);
    expectError(result, field);
  });

  it.each([
    ['maxTurns: -1', -1],
    ['maxTurns: 0', 0],
    ['maxTurns as string', '5'],
  ] as const)('rejects %s', (_label, value) => {
    expectError(validateChatRequest({ prompt: 'hi', maxTurns: value }, ARCHS), 'maxTurns');
  });

  it('accepts maxTurns: 1 and larger positives', () => {
    expect(validateChatRequest({ prompt: 'hi', maxTurns: 1 }, ARCHS).ok).toBe(true);
    expect(validateChatRequest({ prompt: 'hi', maxTurns: 100 }, ARCHS).ok).toBe(true);
  });
});

describe('validateChatRequest — happy path', () => {
  it('accepts a minimal valid request', () => {
    const result = validateChatRequest({ prompt: 'hi' }, ARCHS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prompt).toBe('hi');
      expect(result.data.threadId).toBeUndefined();
      expect(result.data.architecture).toBeUndefined();
    }
  });

  it('accepts a fully-populated valid request and surfaces all fields', () => {
    const body = {
      prompt: 'hello',
      threadId: 't1',
      architecture: 'claude-code',
      model: 'sonnet',
      systemPrompt: 'be helpful',
      sessionId: 'sess-1',
      maxTurns: 10,
      allowedTools: ['Read', 'Edit'],
      architectureConfig: { foo: 'bar' },
      cwd: '/repo',
      planMode: true,
    };
    const result = validateChatRequest(body, ARCHS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(body);
    }
  });
});

describe('validateChatRequest — error accumulation', () => {
  it('returns multiple errors when several fields are invalid', () => {
    const result = validateChatRequest(
      { prompt: '', architecture: 'mystery', maxTurns: 0 },
      ARCHS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map(e => e.field).sort();
      expect(fields).toEqual(['architecture', 'maxTurns', 'prompt']);
    }
  });
});
