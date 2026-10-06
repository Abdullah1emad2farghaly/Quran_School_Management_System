import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 15000,
  },
});
