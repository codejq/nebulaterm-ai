import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.ts',
        'dist/',
        'src-tauri/',
      ],
      include: ['**/*.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@tauri-apps/api/core': path.resolve(__dirname, './tests/__mocks__/@tauri-apps/api/core.ts'),
      '@tauri-apps/api/event': path.resolve(__dirname, './tests/__mocks__/@tauri-apps/api/event.ts'),
      '@xterm/xterm': path.resolve(__dirname, './tests/__mocks__/@xterm/xterm.ts'),
      '@xterm/addon-fit': path.resolve(__dirname, './tests/__mocks__/@xterm/addon-fit.ts'),
      '@xterm/addon-web-links': path.resolve(__dirname, './tests/__mocks__/@xterm/addon-web-links.ts'),
      '@xterm/addon-search': path.resolve(__dirname, './tests/__mocks__/@xterm/addon-search.ts'),
    },
  },
});
