/**
 * Comprehensive unit tests for socket discovery system
 * Tests all scenarios including error cases and edge conditions
 */

import { constants, access, mkdir, readdir, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSocketCache,
  discoverSockets,
  getActiveSockets,
  listInstances,
} from "./socket-discovery.js";
import type {
  HyprlandInstance,
  SocketDiscoveryOptions,
  SocketDiscoveryResult,
  SocketInfo,
} from "./types.js";

// ============================================================================
// Test Setup and Utilities
// ============================================================================

const originalEnv = process.env;
let testDir: string;

beforeEach(async () => {
  // Reset environment
  process.env = { ...originalEnv };

  // Set test environment
  process.env.NODE_ENV = "test";

  // Create temporary test directory
  testDir = join(tmpdir(), `hyprland-ts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });

  // Clear cache before each test
  clearSocketCache();
});

afterEach(() => {
  // Restore environment
  process.env = originalEnv;
  vi.clearAllMocks();
});

/**
 * Creates a mock socket file structure for testing
 */
async function createMockSocketStructure(
  baseDir: string,
  instances: Array<{
    signature: string;
    hasCommand?: boolean;
    hasEvent?: boolean;
    isSocket?: boolean;
  }>
): Promise<void> {
  const hyprDir = join(baseDir, "hypr");
  await mkdir(hyprDir, { recursive: true });

  for (const instance of instances) {
    const instanceDir = join(hyprDir, instance.signature);
    await mkdir(instanceDir, { recursive: true });

    if (instance.hasCommand !== false) {
      const commandSocket = join(instanceDir, `${instance.signature}.socket.sock`);
      await writeFile(commandSocket, "", { mode: 0o600 });
    }

    if (instance.hasEvent !== false) {
      const eventSocket = join(instanceDir, `${instance.signature}.socket2.sock`);
      await writeFile(eventSocket, "", { mode: 0o600 });
    }
  }
}

// ============================================================================
// Socket Discovery Tests
// ============================================================================

describe("discoverSockets", () => {
  describe("environment resolution", () => {
    it("should use HYPRLAND_INSTANCE_SIGNATURE when available", async () => {
      const signature = "abc123def456";
      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;
      process.env.XDG_RUNTIME_DIR = testDir;

      await createMockSocketStructure(testDir, [
        { signature: "abcdef123456", hasCommand: true, hasEvent: true },
        { signature, hasCommand: true, hasEvent: true },
      ]);

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.activeInstance?.signature).toBe(signature);
      expect(result.instances).toHaveLength(2);
    });

    it("should use XDG_RUNTIME_DIR when available", async () => {
      const signature = "abc123de";
      process.env.XDG_RUNTIME_DIR = testDir;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = undefined;

      await createMockSocketStructure(testDir, [{ signature, hasCommand: true, hasEvent: true }]);

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);
    });

    it("should fall back to /tmp when XDG_RUNTIME_DIR is not set", async () => {
      process.env.XDG_RUNTIME_DIR = undefined;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = undefined;

      // Mock the fallback behavior since we can't write to /tmp in tests
      const mockReaddir = vi.fn().mockResolvedValue([]);
      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        return {
          ...actual,
          readdir: mockReaddir,
        };
      });

      const result = await discoverSockets();

      expect(result.success).toBe(false);
      expect(result.error).toContain("No Hyprland instances found");
    });
  });

  describe("instance discovery", () => {
    it("should discover multiple instances", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;

      const instances = [
        { signature: "abc123ef", hasCommand: true, hasEvent: true },
        { signature: "def456ab", hasCommand: true, hasEvent: true },
        { signature: "0123cdef", hasCommand: true, hasEvent: true },
      ];

      await createMockSocketStructure(testDir, instances);

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(3);
      expect(result.instances.map((i) => i.signature)).toEqual(
        expect.arrayContaining(["abc123ef", "def456ab", "0123cdef"])
      );
    });

    it("should handle instances with missing sockets", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;

      const instances = [
        { signature: "abc123ef", hasCommand: true, hasEvent: true },
        { signature: "def456ab", hasCommand: true, hasEvent: false },
        { signature: "0123cdef", hasCommand: false, hasEvent: true },
        { signature: "fedcba98", hasCommand: false, hasEvent: false },
      ];

      await createMockSocketStructure(testDir, instances);

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(3); // Only instances with at least one socket

      const signatures = result.instances.map((i) => i.signature);
      expect(signatures).toContain("abc123ef");
      expect(signatures).toContain("def456ab");
      expect(signatures).toContain("0123cdef");
      expect(signatures).not.toContain("fedcba98");
    });

    it("should filter out non-hex signature directories", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;

      const hyprDir = join(testDir, "hypr");
      await mkdir(hyprDir, { recursive: true });

      // Create valid and invalid directory names
      const directories = [
        "abc123def", // valid hex
        "not-hex-123", // invalid (contains hyphens)
        "ABCDEF123", // valid hex (uppercase)
        "short", // too short
        "abc123def456789a", // valid hex (long)
        "123", // too short
        "g123456789", // invalid (contains non-hex)
      ];

      for (const dir of directories) {
        const dirPath = join(hyprDir, dir);
        await mkdir(dirPath, { recursive: true });
        // Create some sockets for valid directories
        if (/^[a-fA-F0-9]{8,}$/.test(dir)) {
          await writeFile(join(dirPath, `${dir}.socket.sock`), "");
        }
      }

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      const signatures = result.instances.map((i) => i.signature);
      expect(signatures).toContain("abc123def");
      expect(signatures).toContain("ABCDEF123");
      expect(signatures).toContain("abc123def456789a");
      expect(signatures).not.toContain("not-hex-123");
      expect(signatures).not.toContain("short");
      expect(signatures).not.toContain("123");
      expect(signatures).not.toContain("g123456789");
    });
  });

  describe("socket validation", () => {
    it("should validate socket permissions when requested", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;
      const signature = "abc123de";

      await createMockSocketStructure(testDir, [{ signature, hasCommand: true, hasEvent: true }]);

      const result = await discoverSockets({ validatePermissions: true });

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);

      const instance = result.instances[0];
      expect(instance.commandSocket.permissions.readable).toBe(true);
      expect(instance.commandSocket.permissions.writable).toBe(true);
      expect(instance.eventSocket.permissions.readable).toBe(true);
      expect(instance.eventSocket.permissions.writable).toBe(true);
    });

    it("should skip permission validation when disabled", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;
      const signature = "abc123de";

      await createMockSocketStructure(testDir, [{ signature, hasCommand: true, hasEvent: true }]);

      const result = await discoverSockets({ validatePermissions: false });

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);

      const instance = result.instances[0];
      // When validation is disabled, permissions should default to true
      expect(instance.commandSocket.permissions.readable).toBe(true);
      expect(instance.commandSocket.permissions.writable).toBe(true);
    });
  });

  describe("caching", () => {
    it("should cache results when enabled", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;
      const signature = "abc123de";

      await createMockSocketStructure(testDir, [{ signature, hasCommand: true, hasEvent: true }]);

      const result1 = await discoverSockets({ useCache: true });
      const result2 = await discoverSockets({ useCache: true });

      expect(result1).toEqual(result2);
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it("should respect cache timeout", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;
      const signature = "abc123de";

      await createMockSocketStructure(testDir, [{ signature, hasCommand: true, hasEvent: true }]);

      const shortTimeout = 50; // 50ms

      const result1 = await discoverSockets({
        useCache: true,
        cacheTimeout: shortTimeout,
      });

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, shortTimeout + 10));

      // Remove old structure and create a different socket structure
      const hyprDir = join(testDir, "hypr");
      await rmdir(hyprDir, { recursive: true }).catch(() => {
        // Ignore cleanup errors - directory may not exist
      }); // Clean up old structure
      await createMockSocketStructure(testDir, [
        { signature: "def456ab", hasCommand: true, hasEvent: true },
      ]);

      const result2 = await discoverSockets({
        useCache: true,
        cacheTimeout: shortTimeout,
      });

      expect(result1.instances[0]?.signature).toBe("abc123de");
      expect(result2.instances[0]?.signature).toBe("def456ab");
    });

    it("should bypass cache when disabled", async () => {
      process.env.XDG_RUNTIME_DIR = testDir;

      await createMockSocketStructure(testDir, [
        { signature: "abc123de", hasCommand: true, hasEvent: true },
      ]);

      const result1 = await discoverSockets({ useCache: false });

      // Remove old structure and create different socket structure
      const hyprDir = join(testDir, "hypr");
      await rmdir(hyprDir, { recursive: true }).catch(() => {
        // Ignore cleanup errors - directory may not exist
      }); // Clean up old structure
      await createMockSocketStructure(testDir, [
        { signature: "def456ab", hasCommand: true, hasEvent: true },
      ]);

      const result2 = await discoverSockets({ useCache: false });

      expect(result1.instances[0]?.signature).toBe("abc123de");
      expect(result2.instances[0]?.signature).toBe("def456ab");
    });
  });

  describe("error handling", () => {
    it("should handle missing runtime directory", async () => {
      process.env.XDG_RUNTIME_DIR = "/nonexistent/directory";

      const result = await discoverSockets();

      expect(result.success).toBe(false);
      expect(result.error).toContain("No Hyprland instances found");
      expect(result.instances).toHaveLength(0);
    });

    it("should handle permission errors gracefully", async () => {
      // Mock permission errors
      const mockReaddir = vi.fn().mockRejectedValue(new Error("Permission denied"));
      vi.doMock("node:fs/promises", async () => {
        const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
        return {
          ...actual,
          readdir: mockReaddir,
        };
      });

      const result = await discoverSockets();

      expect(result.success).toBe(false);
      expect(result.error).toContain("No Hyprland instances found");
    });

    it("should provide actionable error messages", async () => {
      process.env.XDG_RUNTIME_DIR = undefined;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = undefined;

      const result = await discoverSockets();

      expect(result.success).toBe(false);
      expect(result.error).toContain("No Hyprland instances found");
      expect(result.error).toContain("Ensure Hyprland is running");
      expect(result.error).toContain("HYPRLAND_INSTANCE_SIGNATURE");
    });
  });
});

// ============================================================================
// Convenience Function Tests
// ============================================================================

describe("getActiveSockets", () => {
  it("should return active socket paths when available", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;
    process.env.HYPRLAND_INSTANCE_SIGNATURE = "abc123de";

    await createMockSocketStructure(testDir, [
      { signature: "abc123de", hasCommand: true, hasEvent: true },
    ]);

    const sockets = await getActiveSockets();

    expect(sockets).toBeDefined();
    expect(sockets?.command).toContain("abc123de.socket.sock");
    expect(sockets?.event).toContain("abc123de.socket2.sock");
  });

  it("should return undefined when no active instance", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    const sockets = await getActiveSockets();

    expect(sockets).toBeUndefined();
  });

  it("should return undefined when sockets don't exist", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;
    process.env.HYPRLAND_INSTANCE_SIGNATURE = "abc123de";

    await createMockSocketStructure(testDir, [
      { signature: "abc123de", hasCommand: false, hasEvent: false },
    ]);

    const sockets = await getActiveSockets();

    expect(sockets).toBeUndefined();
  });
});

describe("listInstances", () => {
  it("should return all discovered instances", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    const expectedInstances = [
      { signature: "abc123ef", hasCommand: true, hasEvent: true },
      { signature: "def456ab", hasCommand: true, hasEvent: true },
    ];

    await createMockSocketStructure(testDir, expectedInstances);

    const instances = await listInstances();

    expect(instances).toHaveLength(2);
    expect(instances.map((i) => i.signature)).toEqual(
      expect.arrayContaining(["abc123ef", "def456ab"])
    );
  });

  it("should return empty array when no instances found", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    const instances = await listInstances();

    expect(instances).toHaveLength(0);
  });
});

describe("clearSocketCache", () => {
  it("should clear the cache", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    await createMockSocketStructure(testDir, [
      { signature: "abc123de", hasCommand: true, hasEvent: true },
    ]);

    // Fill cache
    await discoverSockets({ useCache: true });

    // Clear cache
    clearSocketCache();

    // Remove old structure and change socket structure
    const hyprDir = join(testDir, "hypr");
    await rmdir(hyprDir, { recursive: true }).catch(() => {
      // Ignore cleanup errors - directory may not exist
    }); // Clean up old structure
    await createMockSocketStructure(testDir, [
      { signature: "def456ab", hasCommand: true, hasEvent: true },
    ]);

    // Should get new result even with cache enabled
    const result = await discoverSockets({ useCache: true });
    expect(result.instances[0]?.signature).toBe("def456ab");
  });
});

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

describe("edge cases", () => {
  it("should handle empty runtime directory", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    // Create empty hypr directory
    await mkdir(join(testDir, "hypr"), { recursive: true });

    const result = await discoverSockets();

    expect(result.success).toBe(false);
    expect(result.instances).toHaveLength(0);
  });

  it("should handle non-directory files in runtime directory", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    const hyprDir = join(testDir, "hypr");
    await mkdir(hyprDir, { recursive: true });

    // Create a file instead of directory
    await writeFile(join(hyprDir, "notvalid"), "not a directory");

    // Create a valid instance
    await createMockSocketStructure(testDir, [
      { signature: "abc123de", hasCommand: true, hasEvent: true },
    ]);

    const result = await discoverSockets();

    expect(result.success).toBe(true);
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0].signature).toBe("abc123de");
  });

  it("should handle mixed socket availability", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    await createMockSocketStructure(testDir, [
      { signature: "abc123de", hasCommand: true, hasEvent: true },
      { signature: "def456ab", hasCommand: true, hasEvent: false },
      { signature: "0123cdef", hasCommand: false, hasEvent: true },
    ]);

    const result = await discoverSockets();

    expect(result.success).toBe(true);
    expect(result.instances).toHaveLength(3);

    const bothInstance = result.instances.find((i) => i.signature === "abc123de");
    expect(bothInstance?.commandSocket.exists).toBe(true);
    expect(bothInstance?.eventSocket.exists).toBe(true);

    const cmdOnlyInstance = result.instances.find((i) => i.signature === "def456ab");
    expect(cmdOnlyInstance?.commandSocket.exists).toBe(true);
    expect(cmdOnlyInstance?.eventSocket.exists).toBe(false);

    const evtOnlyInstance = result.instances.find((i) => i.signature === "0123cdef");
    expect(evtOnlyInstance?.commandSocket.exists).toBe(false);
    expect(evtOnlyInstance?.eventSocket.exists).toBe(true);
  });

  it("should handle concurrent discovery calls", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    await createMockSocketStructure(testDir, [
      { signature: "abc123de", hasCommand: true, hasEvent: true },
    ]);

    // Make multiple concurrent discovery calls
    const promises = Array.from({ length: 5 }, () => discoverSockets());
    const results = await Promise.all(promises);

    // All results should be identical
    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);
      expect(result.instances[0].signature).toBe("abc123de");
    }
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("performance", () => {
  it("should handle large numbers of instances efficiently", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    // Create many instances
    const instanceCount = 50;
    const instances = Array.from({ length: instanceCount }, (_, i) => ({
      signature: `${i.toString(16).padStart(8, "0")}abc1`,
      hasCommand: true,
      hasEvent: true,
    }));

    await createMockSocketStructure(testDir, instances);

    const startTime = Date.now();
    const result = await discoverSockets();
    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.instances).toHaveLength(instanceCount);
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second
  });

  it("should cache results for improved performance", async () => {
    process.env.XDG_RUNTIME_DIR = testDir;

    await createMockSocketStructure(testDir, [
      { signature: "abc123de", hasCommand: true, hasEvent: true },
    ]);

    // First call (no cache)
    const start1 = Date.now();
    const result1 = await discoverSockets({ useCache: true });
    const duration1 = Date.now() - start1;

    // Second call (cached)
    const start2 = Date.now();
    const result2 = await discoverSockets({ useCache: true });
    const duration2 = Date.now() - start2;

    expect(result1).toEqual(result2);
    expect(duration2).toBeLessThanOrEqual(duration1 + 5); // Cached call should be similar or faster (allow 5ms tolerance)
  });
});
