import React, { useState, useCallback } from 'react';

interface CodeBlockProps {
  language: string;
  code: string;
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div data-ac="code-block">
      <div data-ac="code-header">
        <span data-ac="code-language">{language}</span>
        <button data-ac="code-copy" onClick={handleCopy} type="button">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre data-ac="code-pre">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}
