import React from 'react';

interface ImageBlockProps {
  source: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string };
}

export function ImageBlock({ source }: ImageBlockProps) {
  const src = source.type === 'base64'
    ? `data:${source.mediaType};base64,${source.data}`
    : source.url;

  return (
    <div data-ac="image-block">
      <img data-ac="image" src={src} alt="AI generated content" loading="lazy" />
    </div>
  );
}
