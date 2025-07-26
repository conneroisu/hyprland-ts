/**
 * Comprehensive validation tests for Hyprland type definitions
 * Tests type guards, validators, and edge cases
 */

import { describe, expect, test } from "vitest";
import {
  createMockMonitor,
  createMockWindow,
  createMockWorkspace,
  createMockWorkspaceInfo,
  createMonitorSetup,
  createWindowCluster,
  createWorkspaceSet,
} from "./test-utils.js";
import {
  isHyprlandMonitor,
  isHyprlandWindow,
  isHyprlandWorkspace,
  isHyprlandWorkspaceInfo,
  validateHyprlandMonitor,
  validateHyprlandMonitorArray,
  validateHyprlandWindow,
  validateHyprlandWindowArray,
  validateHyprlandWorkspace,
  validateHyprlandWorkspaceArray,
} from "./validation.js";

describe("Validation Functions", () => {
  describe("validateHyprlandWindow", () => {
    test("validates correct window objects", () => {
      const window = createMockWindow();
      const result = validateHyprlandWindow(window);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(window);
      expect(result.errors).toBeUndefined();
    });

    test("rejects invalid window objects", () => {
      const result = validateHyprlandWindow({ invalid: "data" });

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    test("validates window with custom properties", () => {
      const window = createMockWindow({
        floating: true,
        fullscreen: true,
        hidden: true,
      });

      const result = validateHyprlandWindow(window);
      expect(result.success).toBe(true);
      expect(result.data?.floating).toBe(true);
      expect(result.data?.fullscreen).toBe(true);
      expect(result.data?.hidden).toBe(true);
    });
  });

  describe("validateHyprlandWorkspace", () => {
    test("validates correct workspace objects", () => {
      const workspace = createMockWorkspace();
      const result = validateHyprlandWorkspace(workspace);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(workspace);
    });

    test("validates empty workspace", () => {
      const workspace = createMockWorkspace({
        windows: 0,
        lastwindow: "",
        lastwindowtitle: "",
      });

      const result = validateHyprlandWorkspace(workspace);
      expect(result.success).toBe(true);
      expect(result.data?.windows).toBe(0);
    });
  });

  describe("validateHyprlandMonitor", () => {
    test("validates correct monitor objects", () => {
      const monitor = createMockMonitor();
      const result = validateHyprlandMonitor(monitor);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(monitor);
    });

    test("validates monitor with different configurations", () => {
      const monitor = createMockMonitor({
        scale: 2.0,
        vrr: true,
        focused: false,
      });

      const result = validateHyprlandMonitor(monitor);
      expect(result.success).toBe(true);
      expect(result.data?.scale).toBe(2.0);
      expect(result.data?.vrr).toBe(true);
    });
  });

  describe("Array Validation", () => {
    test("validates window arrays", () => {
      const windows = createWindowCluster(3);
      const result = validateHyprlandWindowArray(windows);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
    });

    test("validates workspace arrays", () => {
      const workspaces = createWorkspaceSet(5);
      const result = validateHyprlandWorkspaceArray(workspaces);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(5);
    });

    test("validates monitor arrays", () => {
      const monitors = createMonitorSetup();
      const result = validateHyprlandMonitorArray(monitors);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });
});

describe("Type Guards", () => {
  describe("isHyprlandWindow", () => {
    test("identifies valid windows", () => {
      const window = createMockWindow();
      expect(isHyprlandWindow(window)).toBe(true);
    });

    test("rejects invalid data", () => {
      expect(isHyprlandWindow({})).toBe(false);
      expect(isHyprlandWindow(null)).toBe(false);
      expect(isHyprlandWindow("string")).toBe(false);
      expect(isHyprlandWindow([])).toBe(false);
    });

    test("validates all required properties", () => {
      const invalidWindow = createMockWindow();
      // Remove a required property to make the window invalid
      (invalidWindow as Record<string, unknown>).address = undefined;

      expect(isHyprlandWindow(invalidWindow)).toBe(false);
    });
  });

  describe("isHyprlandWorkspace", () => {
    test("identifies valid workspaces", () => {
      const workspace = createMockWorkspace();
      expect(isHyprlandWorkspace(workspace)).toBe(true);
    });

    test("rejects invalid data", () => {
      expect(isHyprlandWorkspace({})).toBe(false);
      expect(isHyprlandWorkspace({ id: "invalid" })).toBe(false);
    });
  });

  describe("isHyprlandMonitor", () => {
    test("identifies valid monitors", () => {
      const monitor = createMockMonitor();
      expect(isHyprlandMonitor(monitor)).toBe(true);
    });

    test("rejects invalid data", () => {
      expect(isHyprlandMonitor({})).toBe(false);
      expect(isHyprlandMonitor({ width: "invalid" })).toBe(false);
    });
  });

  describe("isHyprlandWorkspaceInfo", () => {
    test("identifies valid workspace info", () => {
      const workspaceInfo = createMockWorkspaceInfo();
      expect(isHyprlandWorkspaceInfo(workspaceInfo)).toBe(true);
    });

    test("handles special workspace IDs", () => {
      const specialWorkspace = createMockWorkspaceInfo({
        id: -1,
        name: "special:scratchpad",
      });
      expect(isHyprlandWorkspaceInfo(specialWorkspace)).toBe(true);
    });
  });
});

describe("Edge Cases", () => {
  test("handles extreme numeric values", () => {
    const window = createMockWindow({
      at: [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER] as const,
      size: [1920, 1080] as const,
      pid: Number.MAX_SAFE_INTEGER,
    });

    const result = validateHyprlandWindow(window);
    expect(result.success).toBe(true);
  });

  test("handles empty strings", () => {
    const window = createMockWindow({
      title: "",
      class: "",
    });

    const result = validateHyprlandWindow(window);
    expect(result.success).toBe(true);
  });

  test("handles Unicode strings", () => {
    const window = createMockWindow({
      title: "🚀 Test Window",
      class: "unicode-app",
    });

    const result = validateHyprlandWindow(window);
    expect(result.success).toBe(true);
  });
});
