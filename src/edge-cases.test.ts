import { describe, expect, test } from "vitest";
import { createMockWindow } from "./test-utils.js";
import { isHyprlandWindow, validateHyprlandWindow } from "./validation.js";

describe("Edge Case Tests", () => {
  test("should handle extreme numeric values", () => {
    const extremeWindow = createMockWindow({
      at: [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      size: [Number.MAX_SAFE_INTEGER, 0],
      workspace: { id: Number.MAX_SAFE_INTEGER, name: "extreme" },
      fullscreen: true, // Fullscreen enabled
    });

    const result = validateHyprlandWindow(extremeWindow);
    expect(result.success).toBe(true);
  });

  test("should handle unicode and special characters in strings", () => {
    const unicodeWindow = createMockWindow({
      title: "🎮 Gaming Window 🚀 测试 العربية",
      class: "special-chars-!@#$%^&*()",
      workspace: { id: 1, name: "workspace-with-émojis-💻" },
    });

    const result = validateHyprlandWindow(unicodeWindow);
    expect(result.success).toBe(true);
    expect(result.data?.title).toContain("🎮");
  });

  test("should reject null and undefined values", () => {
    const invalidInputs = [null, undefined, "", 0, false, []];

    for (const input of invalidInputs) {
      expect(isHyprlandWindow(input)).toBe(false);

      const result = validateHyprlandWindow(input);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    }
  });

  test("should handle empty strings appropriately", () => {
    const emptyStringWindow = createMockWindow({
      title: "",
      class: "",
      workspace: { id: 1, name: "" },
    });

    const result = validateHyprlandWindow(emptyStringWindow);
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe("");
  });

  test("should handle boundary values for coordinates and sizes", () => {
    const boundaryTests = [
      { at: [0, 0], size: [1, 1] },
      { at: [-1000, -1000], size: [3840, 2160] },
      { at: [0, 0], size: [0, 0] }, // Zero size window
    ];

    for (const testCase of boundaryTests) {
      const window = createMockWindow(testCase);
      const result = validateHyprlandWindow(window);
      expect(result.success).toBe(true);
    }
  });

  test("should handle malformed objects gracefully", () => {
    const malformedObjects = [
      { address: 123 }, // Wrong type
      { address: "0x123", at: "invalid" }, // Wrong type for coordinates
      { address: "0x123", workspace: "not-an-object" }, // Wrong type for workspace
      { address: "0x123", floating: "yes" }, // Wrong type for boolean
    ];

    for (const obj of malformedObjects) {
      expect(isHyprlandWindow(obj)).toBe(false);

      const result = validateHyprlandWindow(obj);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    }
  });
});
