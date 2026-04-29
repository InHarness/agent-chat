import { describe, expect, it } from 'vitest';
import type { StoredMessage, StoredContentBlock } from '../protocol.js';
import { buildHistoryPrompt } from '../historyBuilder.js';

const TS = '2026-04-28T00:00:00.000Z';

function userMsg(text: string, id = 'u'): StoredMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: TS,
  };
}

function assistantMsg(blocks: StoredContentBlock[], id = 'a'): StoredMessage {
  return {
    id,
    role: 'assistant',
    blocks,
    timestamp: TS,
  };
}

describe('buildHistoryPrompt — empty history', () => {
  it('returns the new prompt verbatim when there are no prior messages', () => {
    expect(buildHistoryPrompt([], { newUserPrompt: 'hello' })).toBe('hello');
  });

  it('returns the new prompt verbatim when prior messages render to nothing', () => {
    // Only a thinking block (skipped) → message renders to empty → no transcript section.
    const onlyThinking = assistantMsg([{ type: 'thinking', text: 'private' }]);
    expect(buildHistoryPrompt([onlyThinking], { newUserPrompt: 'hi' })).toBe('hi');
  });
});

describe('buildHistoryPrompt — text-only', () => {
  it('renders user/assistant pairs between delimiters and appends the new prompt', () => {
    const out = buildHistoryPrompt(
      [userMsg('first', 'u1'), assistantMsg([{ type: 'text', text: 'reply 1' }], 'a1')],
      { newUserPrompt: 'follow up' },
    );
    expect(out).toContain('<<< IMPORTED_TRANSCRIPT');
    expect(out).toContain('>>> END_IMPORTED_TRANSCRIPT');
    expect(out).toContain('[USER]\nfirst');
    expect(out).toContain('[ASSISTANT]\nreply 1');
    expect(out.endsWith('[NEW_USER_MESSAGE]\nfollow up')).toBe(true);
  });

  it('stamps (architecture/model) on role marker when present on the message', () => {
    const u: StoredMessage = {
      id: 'u1', role: 'user', timestamp: TS,
      blocks: [{ type: 'text', text: 'first' }],
      architecture: 'claude-code', model: 'opus',
    };
    const a: StoredMessage = {
      id: 'a1', role: 'assistant', timestamp: TS,
      blocks: [{ type: 'text', text: 'reply 1' }],
      architecture: 'claude-code', model: 'opus',
    };
    const out = buildHistoryPrompt([u, a], { newUserPrompt: 'next' });
    expect(out).toContain('[USER (claude-code/opus)]');
    expect(out).toContain('[ASSISTANT (claude-code/opus)]');
  });

  it('falls back to plain [USER]/[ASSISTANT] when arch/model absent (legacy threads)', () => {
    const out = buildHistoryPrompt(
      [userMsg('legacy', 'u1'), assistantMsg([{ type: 'text', text: 'legacy reply' }], 'a1')],
      { newUserPrompt: 'next' },
    );
    expect(out).toContain('[USER]\nlegacy');
    expect(out).toContain('[ASSISTANT]\nlegacy reply');
    expect(out).not.toContain('(claude-code');
  });
});

describe('buildHistoryPrompt — tool annotations', () => {
  it('renders toolUse/toolResult as one-liner annotations', () => {
    const out = buildHistoryPrompt(
      [
        userMsg('do it', 'u1'),
        assistantMsg(
          [
            { type: 'text', text: 'reading' },
            { type: 'toolUse', toolUseId: 't1', toolName: 'Read', input: { path: '/x.ts' } },
            { type: 'toolResult', toolUseId: 't1', content: 'hello world', isError: false },
          ],
          'a1',
        ),
      ],
      { newUserPrompt: 'next' },
    );
    expect(out).toContain('[tool: Read({"path":"/x.ts"})]');
    expect(out).toContain('[tool-result: 11 chars, ok]');
  });

  it('marks errored tool results explicitly', () => {
    const out = buildHistoryPrompt(
      [assistantMsg([{ type: 'toolResult', toolUseId: 't', content: 'boom', isError: true }])],
      { newUserPrompt: 'hi' },
    );
    expect(out).toContain('[tool-result: 4 chars, error]');
  });
});

describe('buildHistoryPrompt — thinking always omitted', () => {
  it('skips thinking blocks regardless of surrounding content', () => {
    const out = buildHistoryPrompt(
      [
        userMsg('q', 'u1'),
        assistantMsg(
          [
            { type: 'thinking', text: 'should-not-appear' },
            { type: 'text', text: 'final answer' },
          ],
          'a1',
        ),
      ],
      { newUserPrompt: 'next' },
    );
    expect(out).not.toContain('should-not-appear');
    expect(out).not.toContain('[thinking');
    expect(out).toContain('final answer');
  });
});

describe('buildHistoryPrompt — todo / image / userInput / subagent', () => {
  it('todoList → counts per status', () => {
    const out = buildHistoryPrompt(
      [
        assistantMsg([
          {
            type: 'todoList',
            items: [
              { id: '1', content: 'a', status: 'completed' },
              { id: '2', content: 'b', status: 'in_progress' },
              { id: '3', content: 'c', status: 'pending' },
              { id: '4', content: 'd', status: 'pending' },
            ],
          },
        ]),
      ],
      { newUserPrompt: 'x' },
    );
    expect(out).toContain('[todo: 4 items — 1 done, 1 in_progress, 2 pending]');
  });

  it('image → media-type or url marker', () => {
    const out = buildHistoryPrompt(
      [
        assistantMsg([
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
        ]),
      ],
      { newUserPrompt: 'x' },
    );
    expect(out).toContain('[image: image/png]');
    expect(out).toContain('[image: url]');
  });

  it('userInputRequest → pending vs accepted vs declined', () => {
    const baseRequest = {
      requestId: 'r',
      source: 'model-tool' as const,
      origin: 'test',
      questions: [{ question: 'continue?' }],
    };
    const pending = buildHistoryPrompt(
      [assistantMsg([{ type: 'userInputRequest', requestId: 'r', request: baseRequest }])],
      { newUserPrompt: 'x' },
    );
    expect(pending).toContain('[user-input-request: "continue?" → pending]');

    const accepted = buildHistoryPrompt(
      [
        assistantMsg([
          {
            type: 'userInputRequest',
            requestId: 'r',
            request: baseRequest,
            response: { action: 'accept', answers: [['yes']] },
          },
        ]),
      ],
      { newUserPrompt: 'x' },
    );
    expect(accepted).toContain('[user-input-request: "continue?" → accepted: [["yes"]]]');

    const declined = buildHistoryPrompt(
      [
        assistantMsg([
          {
            type: 'userInputRequest',
            requestId: 'r',
            request: baseRequest,
            response: { action: 'decline' },
          },
        ]),
      ],
      { newUserPrompt: 'x' },
    );
    expect(declined).toContain('[user-input-request: "continue?" → decline]');
  });

  it('subagent → one-line summary, never expands nested messages', () => {
    const out = buildHistoryPrompt(
      [
        assistantMsg([
          {
            type: 'subagent',
            taskId: 's1',
            toolUseId: 'tu1',
            description: 'find files',
            status: 'completed',
            summary: 'found 3 matches',
            messages: [
              {
                id: 'sm1',
                role: 'assistant',
                blocks: [{ type: 'text', text: 'NESTED-SHOULD-NOT-APPEAR' }],
                timestamp: TS,
              },
            ],
          },
        ]),
      ],
      { newUserPrompt: 'x' },
    );
    expect(out).toContain('[subagent "find files" — completed: found 3 matches]');
    expect(out).not.toContain('NESTED-SHOULD-NOT-APPEAR');
  });
});

describe('buildHistoryPrompt — maxChars', () => {
  it('drops the oldest turns FIFO and emits an omission preamble', () => {
    // Build 4 turns of roughly equal size; budget keeps only the last 2.
    const longText = 'x'.repeat(100);
    const messages: StoredMessage[] = [
      userMsg(`u1 ${longText}`, 'u1'),
      assistantMsg([{ type: 'text', text: `a1 ${longText}` }], 'a1'),
      userMsg(`u2 ${longText}`, 'u2'),
      assistantMsg([{ type: 'text', text: `a2 ${longText}` }], 'a2'),
    ];
    // Each rendered turn ~ 110 chars + role marker; 250-char budget keeps ~2 turns.
    const out = buildHistoryPrompt(messages, { newUserPrompt: 'next', maxChars: 250 });
    expect(out).toContain('earlier turn');
    expect(out).toContain('omitted');
    expect(out).toContain(`a2 ${longText}`); // newest survives
    expect(out).not.toContain(`u1 ${longText}`); // oldest gone
  });

  it('no preamble when history fits within the budget', () => {
    const out = buildHistoryPrompt(
      [userMsg('short', 'u1'), assistantMsg([{ type: 'text', text: 'reply' }], 'a1')],
      { newUserPrompt: 'next', maxChars: 10_000 },
    );
    expect(out).not.toContain('omitted');
  });
});
