import { describe, expect, test } from "vitest";
import { createMockWindow } from "./test-utils.js";
import { validateHyprlandWindow } from "./validation.js";

describe("Performance Tests", () => {
  test("validateHyprlandWindow should handle multiple validations efficiently", () => {
    const window = createMockWindow();
    const iterations = 1000;

    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const result = validateHyprlandWindow(window);
      expect(result.success).toBe(true);
    }

    const end = performance.now();
    const duration = end - start;

    // Should complete 1000 validations in reasonable time (less than 100ms)
    expect(duration).toBeLessThan(100);

    // Should handle at least 10,000 operations per second
    const operationsPerSecond = (iterations / duration) * 1000;
    expect(operationsPerSecond).toBeGreaterThan(10000);
  });

  test("validation should scale linearly with array size", () => {
    // Test with different array sizes
    const sizes = [1, 10, 100];
    const timings: number[] = [];

    for (const size of sizes) {
      const windows = Array(size)
        .fill(null)
        .map(() => createMockWindow());

      const start = performance.now();

      for (const window of windows) {
        const result = validateHyprlandWindow(window);
        expect(result.success).toBe(true);
      }

      const end = performance.now();
      timings.push(end - start);
    }

    // Ensure timing scales reasonably (not exponentially)
    // 100x size should not be more than 200x slower
    const ratio = timings[2] / timings[0];
    expect(ratio).toBeLessThan(200);
  });
});
