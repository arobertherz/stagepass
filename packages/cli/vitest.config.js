import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Serialize memory-heavy command tests (new.test.js / php-new.test.js).
    // Uncapped forks OOM on the Cerebro self-hosted runner (heap limit,
    // not assertion failures). execArgv applies to worker processes.
    maxWorkers: 1,
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=8192'],
      },
    },
  },
});
