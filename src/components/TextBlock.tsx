import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock.js';

interface TextBlockProps {
  text: string;
  isStreaming: boolean;
}

export function TextBlock({ text, isStreaming }: TextBlockProps) {
  return (
    <div data-ac="text-block" data-streaming={isStreaming || undefined}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match;
            if (isInline) {
              return <code data-ac="inline-code" className={className} {...props}>{children}</code>;
            }
            return <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} />;
          },
        }}
      >
        {text}
      </Markdown>
      {isStreaming && <span data-ac="cursor" />}
    </div>
  );
}
