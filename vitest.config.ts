import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // tests/db needs a real database; run it with `npm run test:db`
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/db/**'],
    env: { NODE_ENV: 'test' },
  },
});
