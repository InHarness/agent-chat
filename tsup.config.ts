import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

export default defineConfig([
  // Client bundle (React components + hooks)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: true,
    clean: true,
    outDir: 'dist',
    external: ['react', 'react-dom', '@inharness-ai/agent-adapters'],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
    onSuccess: async () => {
      // Copy CSS files to dist/styles/
      mkdirSync('dist/styles', { recursive: true });
      const stylesDir = 'src/styles';
      for (const file of readdirSync(stylesDir)) {
        if (file.endsWith('.css')) {
          copyFileSync(join(stylesDir, file), join('dist/styles', file));
        }
      }
    },
  },
  // Server bundle (Express handlers)
  {
    entry: { 'server/index': 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: true,
    outDir: 'dist',
    external: ['@inharness-ai/agent-adapters', 'express'],
    platform: 'node',
  },
]);
