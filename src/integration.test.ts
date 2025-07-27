import { describe, expect, test } from "vitest";
import { createMockWindow, createWindowCluster } from "./test-utils.js";
import { validateHyprlandWindow, validateHyprlandWindowArray } from "./validation.js";

describe("Integration Tests", () => {
  test("should validate complete window management workflow", () => {
    // Simulate a typical workflow with multiple windows
    const windows = createWindowCluster(5);

    // Step 1: Validate individual windows
    for (const window of windows) {
      const result = validateHyprlandWindow(window);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }

    // Step 2: Validate window array
    const arrayResult = validateHyprlandWindowArray(windows);
    expect(arrayResult.success).toBe(true);
    expect(arrayResult.data).toHaveLength(5);

    // Step 3: Verify data integrity
    if (arrayResult.success) {
      expect(arrayResult.data.every((w) => typeof w.address === "string")).toBe(true);
      expect(arrayResult.data.every((w) => typeof w.title === "string")).toBe(true);
      expect(arrayResult.data.every((w) => typeof w.class === "string")).toBe(true);
    }
  });

  test("should handle mixed valid and invalid data gracefully", () => {
    const validWindow = createMockWindow();
    const invalidData = { not: "a window" };
    const mixedArray = [validWindow, invalidData, createMockWindow()];

    // Individual validation should work for valid items
    expect(validateHyprlandWindow(validWindow).success).toBe(true);
    expect(validateHyprlandWindow(invalidData).success).toBe(false);

    // Array validation should fail if any item is invalid
    const arrayResult = validateHyprlandWindowArray(mixedArray);
    expect(arrayResult.success).toBe(false);
    expect(arrayResult.errors).toBeDefined();
  });

  test("should handle large datasets efficiently", () => {
    // Create a larger dataset to test performance
    const largeDataset = createWindowCluster(100);

    const start = performance.now();
    const result = validateHyprlandWindowArray(largeDataset);
    const end = performance.now();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(100);

    // Should process 100 windows in reasonable time
    const duration = end - start;
    expect(duration).toBeLessThan(50); // Less than 50ms for 100 windows
  });

  test("should maintain data consistency across operations", () => {
    const originalWindow = createMockWindow({
      title: "Original Title",
      floating: true,
      workspace: { id: 42, name: "test-workspace" },
    });

    // Validate original
    const result1 = validateHyprlandWindow(originalWindow);
    expect(result1.success).toBe(true);

    // Ensure validation doesn't mutate original data
    expect(originalWindow.title).toBe("Original Title");
    expect(originalWindow.floating).toBe(true);
    expect(originalWindow.workspace.id).toBe(42);

    // Create array and validate
    const windowArray = [originalWindow, createMockWindow()];
    const arrayResult = validateHyprlandWindowArray(windowArray);

    expect(arrayResult.success).toBe(true);
    expect(originalWindow.title).toBe("Original Title"); // Still unchanged
  });

  test("should handle concurrent validation operations", () => {
    const windows = createWindowCluster(20);

    // Simulate concurrent validations
    const promises = windows.map((window) => Promise.resolve(validateHyprlandWindow(window)));

    return Promise.all(promises).then((results) => {
      expect(results).toHaveLength(20);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});
