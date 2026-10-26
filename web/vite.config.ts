import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

// WKWebView blocks module scripts (and `crossorigin` requests) loaded from file://, so the build is one classic script.
function classicScript(): Plugin {
  return {
    name: 'classic-script',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(/<script type="module" crossorigin /g, '<script defer ').replace(/(<link rel="stylesheet") crossorigin/g, '$1'),
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build also works when loaded via file:// (WKWebView).
  base: './',
  plugins: [classicScript()],
  build: { rollupOptions: { output: { format: 'iife' } } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
