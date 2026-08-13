import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cap the worker count so one `vitest run` cannot exhaust memory on a
    // developer machine. Vitest defaults to one fork per CPU core, so on a
    // 10-core box a single run forks 10 workers that each load the whole
    // module graph — enough to OOM a 24 GB machine on its own.
    // Override when a bigger box can take it: VITEST_MAX_FORKS=<n>.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: Number(process.env.VITEST_MAX_FORKS) || 4,
        minForks: 1,
      },
    },
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
