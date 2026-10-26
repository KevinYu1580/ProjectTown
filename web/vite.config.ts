import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build also works when loaded via file:// (WKWebView).
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
