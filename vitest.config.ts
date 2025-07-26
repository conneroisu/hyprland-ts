import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: ["node_modules", "dist", "coverage"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "coverage/",
        "dist/",
        "**/*.d.ts",
      ],
    },
    typecheck: {
      enabled: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  },
});