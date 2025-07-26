import { describe, expect, it } from "vitest";

describe("utils", () => {
  it("should run basic test to verify vitest setup", () => {
    const result = 2 + 2;
    expect(result).toBe(4);
  });

  it("should handle async operations", async () => {
    const asyncOperation = async (): Promise<string> => {
      return new Promise((resolve) => {
        setTimeout(() => resolve("test"), 10);
      });
    };

    const result = await asyncOperation();
    expect(result).toBe("test");
  });

  it("should handle error cases", () => {
    const throwError = (): never => {
      throw new Error("Test error");
    };

    expect(() => throwError()).toThrow("Test error");
  });
});
