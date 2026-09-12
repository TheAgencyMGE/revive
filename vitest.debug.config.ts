import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['tests/*.manual.ts'],
    testTimeout: 600_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
