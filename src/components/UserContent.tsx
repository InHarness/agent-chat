import React from 'react';
import type { UIContentBlock } from '../types.js';

interface UserContentProps {
  blocks: UIContentBlock[];
}

export function UserContent({ blocks }: UserContentProps) {
  return (
    <div data-ac="user-content">
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return <p key={i} data-ac="user-text">{block.text}</p>;
        }
        return null;
      })}
    </div>
  );
}
