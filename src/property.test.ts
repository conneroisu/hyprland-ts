import { describe, expect, test } from "vitest";
import { createMockWindow } from "./test-utils.js";
import { isHyprlandWindow, validateHyprlandWindow } from "./validation.js";

describe("Property-Based Tests", () => {
  test("validateHyprlandWindow should always succeed for valid windows", () => {
    // Test with various combinations of properties
    const variations = [
      { floating: true, fullscreen: false },
      { floating: false, fullscreen: true },
      { floating: true, fullscreen: false },
      { floating: false, fullscreen: true },
    ];

    for (const variation of variations) {
      const window = createMockWindow(variation);
      const result = validateHyprlandWindow(window);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.floating).toBe(variation.floating);
        expect(result.data.fullscreen).toBe(variation.fullscreen);
      }
    }
  });

  test("isHyprlandWindow should maintain type consistency", () => {
    // Generate multiple valid windows with different properties
    const testCases = [
      createMockWindow({ title: "Test Window 1" }),
      createMockWindow({ class: "test-class" }),
      createMockWindow({ workspace: { id: 42, name: "test-workspace" } }),
      createMockWindow({ floating: true }),
      createMockWindow({ fullscreen: true }),
    ];

    for (const window of testCases) {
      // Type guard should return true for valid windows
      expect(isHyprlandWindow(window)).toBe(true);

      // Validation should also succeed
      const result = validateHyprlandWindow(window);
      expect(result.success).toBe(true);
    }
  });

  test("validation should reject objects with missing required properties", () => {
    const incompleteObjects = [
      { address: "0x123" }, // Missing many required fields
      { title: "Test" }, // Missing address and other fields
      { class: "test" }, // Missing address and other fields
      {}, // Empty object
    ];

    for (const obj of incompleteObjects) {
      expect(isHyprlandWindow(obj)).toBe(false);

      const result = validateHyprlandWindow(obj);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    }
  });
});
