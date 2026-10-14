import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 15000,
    // These tests clear shared tables inside always-rolled-back transactions and hold table-wide locks; running files
    // at the same time makes them deadlock each other. One file at a time.
    fileParallelism: false,
  },
});
