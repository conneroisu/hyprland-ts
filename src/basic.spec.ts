import { describe, expect, test } from "vitest";
import { createMockWindow } from "./test-utils.js";

describe("Simple Test Suite Verification", () => {
  test("should create mock window", () => {
    const window = createMockWindow();

    expect(window).toBeDefined();
    expect(typeof window.address).toBe("string");
    expect(typeof window.mapped).toBe("boolean");
    expect(Array.isArray(window.at)).toBe(true);
    expect(window.at).toHaveLength(2);
  });

  test("should handle custom window properties", () => {
    const window = createMockWindow({
      title: "Test Window",
      floating: true,
    });

    expect(window.title).toBe("Test Window");
    expect(window.floating).toBe(true);
  });
});
