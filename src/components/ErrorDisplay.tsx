import React from 'react';

interface ErrorDisplayProps {
  error: Error;
}

export function ErrorDisplay({ error }: ErrorDisplayProps) {
  return (
    <div data-ac="error">
      <span data-ac="error-icon">!</span>
      <span data-ac="error-message">{error.message}</span>
    </div>
  );
}
