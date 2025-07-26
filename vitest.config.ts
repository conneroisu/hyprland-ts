import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["node_modules", "dist", "coverage"],
    testTimeout: 5000,
    hookTimeout: 5000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        global: {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
      },
      exclude: [
        "node_modules/",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/test-utils.ts",
        "coverage/",
        "dist/",
        "**/*.d.ts",
        "vitest.config.ts",
        "tsup.config.ts",
      ],
      include: [
        "src/**/*.ts",
      ],
    },
    typecheck: {
      enabled: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      tsconfig: "./tsconfig.json",
    },
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 2,
        minThreads: 1,
      },
    },
    reporter: ["default", "json"],
    outputFile: {
      json: "./test-results.json",
    },
  },
});