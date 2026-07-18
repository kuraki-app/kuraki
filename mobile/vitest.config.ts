import { defineConfig } from 'vitest/config';

// Only the pure logic modules are unit-tested here — no RN runtime, no jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      'expo-secure-store': new URL('./test/mocks/expo-secure-store.ts', import.meta.url).pathname,
      'expo-sqlite': new URL('./test/mocks/expo-sqlite.ts', import.meta.url).pathname,
    },
  },
});
