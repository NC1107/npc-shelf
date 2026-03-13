import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/server/src/**/__tests__/**/*.test.ts'],
    testTimeout: 15000,
  },
});
