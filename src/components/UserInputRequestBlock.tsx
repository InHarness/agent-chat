import React, { useState } from 'react';
import type { UserInputRequest, UserInputResponse, UserInputQuestion } from '@inharness-ai/agent-adapters';

interface UserInputRequestBlockProps {
  request: UserInputRequest;
  response?: UserInputResponse;
  onRespond?: (requestId: string, response: UserInputResponse) => Promise<void> | void;
}

function initialDraft(questions: UserInputQuestion[]): string[][] {
  return questions.map(() => []);
}

export function UserInputRequestBlock({ request, response, onRespond }: UserInputRequestBlockProps) {
  const [open, setOpen] = useState(!response);
  const [draft, setDraft] = useState<string[][]>(() => initialDraft(request.questions));
  const [submitting, setSubmitting] = useState(false);

  const canRespond = !response && !!onRespond;
  const actionColor = response?.action === 'accept'
    ? 'var(--ac-text-accept, #16a34a)'
    : response?.action === 'decline'
      ? 'var(--ac-text-decline, #d97706)'
      : response?.action === 'cancel'
        ? 'var(--ac-text-muted)'
        : 'var(--ac-text-secondary)';
  const actionLabel = response?.action ?? 'pending';

  const submit = async (action: UserInputResponse['action']) => {
    if (!canRespond || submitting) return;
    setSubmitting(true);
    const payload: UserInputResponse = action === 'accept'
      ? { action: 'accept', answers: draft }
      : { action };
    try {
      await onRespond!(request.requestId, payload);
    } finally {
      setSubmitting(false);
    }
  };

  const setQuestionAnswer = (qIdx: number, values: string[]) => {
    setDraft(prev => {
      const next = prev.slice();
      next[qIdx] = values;
      return next;
    });
  };

  return (
    <div data-ac="user-input-request" data-pending={canRespond || undefined}>
      <button
        type="button"
        data-ac="user-input-toggle"
        onClick={() => setOpen(v => !v)}
      >
        <span data-ac="user-input-icon">?</span>
        <span data-ac="user-input-origin">
          {request.source === 'mcp-elicitation' ? `mcp · ${request.origin}` : request.origin}
        </span>
        <span data-ac="user-input-flex" />
        <span data-ac="user-input-status" style={{ color: actionColor }}>
          {actionLabel}
        </span>
        <span data-ac="toggle-arrow">{open ? '▾' : '▸'}</span>
      </button>
      {!open && (
        <div data-ac="user-input-preview">
          {request.questions[0]?.question ?? '(question)'}
        </div>
      )}
      {open && (
        <div data-ac="user-input-body">
          {request.questions.map((q, i) => {
            const persistedAnswer = response?.answers?.[i] ?? [];
            return (
              <div key={i} data-ac="user-input-question">
                {q.header && <div data-ac="user-input-question-header">{q.header}</div>}
                <div data-ac="user-input-question-text">{q.question}</div>
                {canRespond ? (
                  <QuestionEditor
                    question={q}
                    values={draft[i] ?? []}
                    onChange={(vals) => setQuestionAnswer(i, vals)}
                  />
                ) : persistedAnswer.length > 0 ? (
                  <ul data-ac="user-input-answers">
                    {persistedAnswer.map((a, j) => (
                      <li key={j}>{a}</li>
                    ))}
                  </ul>
                ) : (
                  <div data-ac="user-input-empty-answer">(no answer)</div>
                )}
              </div>
            );
          })}
          {canRespond && (
            <div data-ac="user-input-actions">
              <button
                type="button"
                data-ac="user-input-action"
                data-action="decline"
                disabled={submitting}
                onClick={() => submit('decline')}
              >
                Decline
              </button>
              <button
                type="button"
                data-ac="user-input-action"
                data-action="cancel"
                disabled={submitting}
                onClick={() => submit('cancel')}
              >
                Cancel
              </button>
              <button
                type="button"
                data-ac="user-input-action"
                data-action="accept"
                disabled={submitting}
                onClick={() => submit('accept')}
              >
                {submitting ? 'Sending…' : 'Send'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface QuestionEditorProps {
  question: UserInputQuestion;
  values: string[];
  onChange: (values: string[]) => void;
}

function QuestionEditor({ question, values, onChange }: QuestionEditorProps) {
  const hasOptions = Array.isArray(question.options) && question.options.length > 0;
  const [customText, setCustomText] = useState('');

  if (!hasOptions) {
    return (
      <textarea
        data-ac="user-input-textarea"
        placeholder={question.placeholder ?? 'Type your answer…'}
        value={values[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        rows={3}
      />
    );
  }

  const toggle = (label: string) => {
    if (question.multiSelect) {
      const next = values.includes(label) ? values.filter(v => v !== label) : [...values, label];
      onChange(next);
    } else {
      onChange(values[0] === label ? [] : [label]);
    }
  };

  const addCustom = () => {
    const trimmed = customText.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) return;
    onChange(question.multiSelect ? [...values, trimmed] : [trimmed]);
    setCustomText('');
  };

  return (
    <div data-ac="user-input-options">
      {question.options!.map((opt, idx) => {
        const selected = values.includes(opt.label);
        return (
          <button
            key={idx}
            type="button"
            data-ac="user-input-option"
            data-selected={selected || undefined}
            onClick={() => toggle(opt.label)}
          >
            <span data-ac="user-input-option-label">{opt.label}</span>
            {opt.description && (
              <span data-ac="user-input-option-description">{opt.description}</span>
            )}
          </button>
        );
      })}
      {question.allowCustom && (
        <div data-ac="user-input-custom">
          <input
            type="text"
            data-ac="user-input-custom-input"
            placeholder={question.placeholder ?? 'Custom answer…'}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button type="button" data-ac="user-input-custom-add" onClick={addCustom}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
