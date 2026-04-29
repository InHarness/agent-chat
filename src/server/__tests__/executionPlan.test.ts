import { describe, expect, it } from 'vitest';
import type { StoredThread, StoredMessage } from '../protocol.js';
import { resolveExecutionPlan, isResumeFailureError, buildReplayPromptForFallback } from '../executionPlan.js';

const TS = '2026-04-28T00:00:00.000Z';

function thread(overrides: Partial<StoredThread> = {}): StoredThread {
  return {
    id: 't1',
    title: 'test',
    architecture: 'claude-code',
    model: 'sonnet',
    sessionId: 'sess-1',
    createdAt: TS,
    updatedAt: TS,
    messages: [],
    ...overrides,
  };
}

function uMsg(text: string, id = 'u'): StoredMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: TS };
}

function aMsg(text: string, id = 'a'): StoredMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: TS };
}

describe('resolveExecutionPlan', () => {
  it('no existing thread → resume undefined, plain prompt, no replay flags', () => {
    const plan = resolveExecutionPlan({
      existingThread: null,
      requestedArchitecture: 'claude-code',
      requestedModel: 'sonnet',
      requestedSessionId: undefined,
      prompt: 'hi',
    });
    expect(plan).toEqual({
      resumeSessionId: undefined,
      prompt: 'hi',
      archChanged: false,
      modelChanged: false,
      requiresHistoryReplay: false,
    });
  });

  it('arch and model unchanged → resumes existing sessionId, prompt unchanged', () => {
    const plan = resolveExecutionPlan({
      existingThread: thread({ messages: [uMsg('prev'), aMsg('rep')] }),
      requestedArchitecture: 'claude-code',
      requestedModel: 'sonnet',
      requestedSessionId: undefined,
      prompt: 'next',
    });
    expect(plan.resumeSessionId).toBe('sess-1');
    expect(plan.prompt).toBe('next');
    expect(plan.archChanged).toBe(false);
    expect(plan.modelChanged).toBe(false);
    expect(plan.requiresHistoryReplay).toBe(false);
  });

  it('chatReq.sessionId wins over existing thread sessionId', () => {
    const plan = resolveExecutionPlan({
      existingThread: thread({ sessionId: 'sess-stored' }),
      requestedArchitecture: 'claude-code',
      requestedModel: 'sonnet',
      requestedSessionId: 'sess-from-req',
      prompt: 'next',
    });
    expect(plan.resumeSessionId).toBe('sess-from-req');
  });

  it('arch changed → drops resume, wraps prompt with prior transcript, sets flags', () => {
    const plan = resolveExecutionPlan({
      existingThread: thread({
        architecture: 'claude-code',
        messages: [uMsg('first'), aMsg('reply 1')],
      }),
      requestedArchitecture: 'gemini',
      requestedModel: 'gemini-flash',
      requestedSessionId: undefined,
      prompt: 'follow up',
    });
    expect(plan.archChanged).toBe(true);
    expect(plan.requiresHistoryReplay).toBe(true);
    expect(plan.resumeSessionId).toBeUndefined();
    expect(plan.prompt).toContain('<<< IMPORTED_TRANSCRIPT');
    expect(plan.prompt).toContain('reply 1');
    expect(plan.prompt.endsWith('follow up')).toBe(true);
  });

  it('arch changed but messages are empty → resume undefined, prompt unchanged', () => {
    const plan = resolveExecutionPlan({
      existingThread: thread({ architecture: 'claude-code', messages: [] }),
      requestedArchitecture: 'gemini',
      requestedModel: 'gemini-flash',
      requestedSessionId: undefined,
      prompt: 'first turn',
    });
    expect(plan.archChanged).toBe(true);
    expect(plan.requiresHistoryReplay).toBe(true);
    expect(plan.resumeSessionId).toBeUndefined();
    expect(plan.prompt).toBe('first turn');
  });

  it('claude-code: model swap keeps the resumed session (capability allows it)', () => {
    const plan = resolveExecutionPlan({
      existingThread: thread({
        architecture: 'claude-code',
        model: 'opus',
        messages: [uMsg('q'), aMsg('a')],
      }),
      requestedArchitecture: 'claude-code',
      requestedModel: 'sonnet',
      requestedSessionId: undefined,
      prompt: 'next',
    });
    expect(plan.archChanged).toBe(false);
    expect(plan.modelChanged).toBe(true);
    expect(plan.requiresHistoryReplay).toBe(false);
    expect(plan.resumeSessionId).toBe('sess-1');
    expect(plan.prompt).toBe('next');
  });

  it('unknown architecture: model swap forces replay (default capability)', () => {
    const plan = resolveExecutionPlan({
      existingThread: thread({
        architecture: 'codex',
        model: 'gpt-5',
        messages: [uMsg('q'), aMsg('a')],
      }),
      requestedArchitecture: 'codex',
      requestedModel: 'gpt-5-mini',
      requestedSessionId: undefined,
      prompt: 'next',
    });
    expect(plan.archChanged).toBe(false);
    expect(plan.modelChanged).toBe(true);
    expect(plan.requiresHistoryReplay).toBe(true);
    expect(plan.resumeSessionId).toBeUndefined();
    expect(plan.prompt).toContain('<<< IMPORTED_TRANSCRIPT');
  });
});

describe('isResumeFailureError', () => {
  it('matches codex "no rollout found"', () => {
    const err = new Error('thread/resume: thread/resume failed: no rollout found for thread id ec3d1a1f-7ae2-4b27-a489-0d4f9e69102a');
    expect(isResumeFailureError(err)).toBe(true);
  });

  it('matches generic resume-failed phrasings', () => {
    expect(isResumeFailureError(new Error('session not found: abc'))).toBe(true);
    expect(isResumeFailureError(new Error('resume failed'))).toBe(true);
    expect(isResumeFailureError(new Error('no such session'))).toBe(true);
  });

  it('does not match unrelated runtime errors', () => {
    expect(isResumeFailureError(new Error('rate limit exceeded'))).toBe(false);
    expect(isResumeFailureError(new Error('connection refused'))).toBe(false);
    expect(isResumeFailureError(new Error('invalid model'))).toBe(false);
  });

  it('handles non-Error values without throwing', () => {
    expect(isResumeFailureError('no rollout found')).toBe(true);
    expect(isResumeFailureError(undefined)).toBe(false);
    expect(isResumeFailureError(null)).toBe(false);
    expect(isResumeFailureError(42)).toBe(false);
  });
});

describe('buildReplayPromptForFallback', () => {
  it('returns plain prompt when there are no prior messages', () => {
    expect(buildReplayPromptForFallback([], 'hi')).toBe('hi');
  });

  it('wraps the transcript when prior messages exist', () => {
    const messages: StoredMessage[] = [
      { id: 'u', role: 'user', blocks: [{ type: 'text', text: 'past q' }], timestamp: TS },
      { id: 'a', role: 'assistant', blocks: [{ type: 'text', text: 'past a' }], timestamp: TS },
    ];
    const out = buildReplayPromptForFallback(messages, 'next');
    expect(out).toContain('<<< IMPORTED_TRANSCRIPT');
    expect(out).toContain('past a');
    expect(out.endsWith('next')).toBe(true);
  });
});
