import React, { useEffect, useState } from 'react';

interface ToolJsonModalProps {
  toolName: string;
  input: unknown;
  result: unknown;
  isError?: boolean;
  onClose: () => void;
}

export function ToolJsonModal({ toolName, input, result, isError, onClose }: ToolJsonModalProps) {
  const [copied, setCopied] = useState<'input' | 'result' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (which: 'input' | 'result', value: unknown) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopied(which);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div data-ac="tool-json-modal-overlay" onClick={onClose}>
      <div data-ac="tool-json-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div data-ac="tool-json-modal-header">
          <span data-ac="tool-json-modal-title">{toolName}</span>
          <button
            type="button"
            data-ac="tool-json-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div data-ac="tool-json-modal-body">
          <section data-ac="tool-json-section">
            <div data-ac="tool-json-section-header">
              <span data-ac="tool-json-section-label">Input</span>
              <button
                type="button"
                data-ac="tool-json-copy"
                onClick={() => copy('input', input)}
              >
                {copied === 'input' ? 'copied' : 'copy'}
              </button>
            </div>
            <pre data-ac="tool-json-pre">{JSON.stringify(input, null, 2)}</pre>
          </section>
          {result !== null && result !== undefined && (
            <section data-ac="tool-json-section">
              <div data-ac="tool-json-section-header">
                <span data-ac="tool-json-section-label" data-error={isError || undefined}>
                  {isError ? 'Error' : 'Result'}
                </span>
                <button
                  type="button"
                  data-ac="tool-json-copy"
                  onClick={() => copy('result', result)}
                >
                  {copied === 'result' ? 'copied' : 'copy'}
                </button>
              </div>
              <pre data-ac="tool-json-pre" data-error={isError || undefined}>
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
