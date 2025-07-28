/**
 * Integration tests for socket discovery system
 * Tests realistic scenarios with actual socket-like files and real Hyprland patterns
 */

import { chmod, mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSocketCache,
  discoverSockets,
  getActiveSockets,
  listInstances,
} from "./socket-discovery.js";

// ============================================================================
// Test Setup
// ============================================================================

let testRuntimeDir: string;
let testHyprDir: string;

beforeEach(async () => {
  // Create isolated test environment
  testRuntimeDir = join(
    tmpdir(),
    `hyprland-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  testHyprDir = join(testRuntimeDir, "hypr");
  await mkdir(testHyprDir, { recursive: true });

  // Set test environment
  process.env.NODE_ENV = "test";

  // Clear cache
  clearSocketCache();
});

afterEach(async () => {
  // Cleanup test directory
  try {
    await rmdir(testRuntimeDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});

/**
 * Creates a realistic Hyprland socket structure
 */
async function createRealisticHyprlandInstance(
  signature: string,
  options: {
    commandSocket?: boolean;
    eventSocket?: boolean;
    permissions?: number;
  } = {}
) {
  const { commandSocket = true, eventSocket = true, permissions = 0o600 } = options;

  const instanceDir = join(testHyprDir, signature);
  await mkdir(instanceDir, { recursive: true });

  if (commandSocket) {
    const cmdPath = join(instanceDir, `${signature}.socket.sock`);
    await writeFile(cmdPath, "");
    await chmod(cmdPath, permissions);
  }

  if (eventSocket) {
    const evtPath = join(instanceDir, `${signature}.socket2.sock`);
    await writeFile(evtPath, "");
    await chmod(evtPath, permissions);
  }

  return instanceDir;
}

// ============================================================================
// Realistic Scenario Tests
// ============================================================================

describe("socket discovery integration", () => {
  describe("single instance scenarios", () => {
    it("should discover active Hyprland instance with proper signatures", async () => {
      const signature = "1a2b3c4d5e6f7890"; // Realistic 16-char hex
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;

      await createRealisticHyprlandInstance(signature);

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);
      expect(result.activeInstance?.signature).toBe(signature);
      expect(result.activeInstance?.commandSocket.exists).toBe(true);
      expect(result.activeInstance?.eventSocket.exists).toBe(true);
      expect(result.activeInstance?.commandSocket.path).toContain(`${signature}.socket.sock`);
      expect(result.activeInstance?.eventSocket.path).toContain(`${signature}.socket2.sock`);
    });

    it("should handle instance with only command socket", async () => {
      const signature = "abcdef1234567890";
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;

      await createRealisticHyprlandInstance(signature, {
        commandSocket: true,
        eventSocket: false,
      });

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);
      expect(result.activeInstance?.commandSocket.exists).toBe(true);
      expect(result.activeInstance?.eventSocket.exists).toBe(false);
    });

    it("should handle restricted socket permissions", async () => {
      const signature = "fedcba0987654321";
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;

      await createRealisticHyprlandInstance(signature, {
        permissions: 0o000, // No permissions
      });

      const result = await discoverSockets({ validatePermissions: true });

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);
      expect(result.activeInstance?.commandSocket.permissions.readable).toBe(false);
      expect(result.activeInstance?.commandSocket.permissions.writable).toBe(false);
    });
  });

  describe("multiple instance scenarios", () => {
    it("should discover multiple concurrent Hyprland instances", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = "abc123456789";

      const instances = ["abc123456789", "def456789abc", "0123456789ab", "fedcba987654"];

      for (const signature of instances) {
        await createRealisticHyprlandInstance(signature);
      }

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(4);
      expect(result.activeInstance?.signature).toBe("abc123456789");

      // Verify all instances were discovered
      const discoveredSignatures = result.instances.map((i) => i.signature);
      for (const signature of instances) {
        expect(discoveredSignatures).toContain(signature);
      }
    });

    it("should handle mixed instance states", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = undefined; // No active instance specified

      await createRealisticHyprlandInstance("abc123456789", {
        commandSocket: true,
        eventSocket: true,
      });

      await createRealisticHyprlandInstance("def456789abc", {
        commandSocket: true,
        eventSocket: false,
      });

      await createRealisticHyprlandInstance("0fedcba98765", {
        commandSocket: false,
        eventSocket: true,
      });

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(3);

      // Should default to first instance when no signature specified
      expect(result.activeInstance).toBeDefined();

      // Verify socket states
      const completeInstance = result.instances.find((i) => i.signature === "abc123456789");
      expect(completeInstance?.commandSocket.exists).toBe(true);
      expect(completeInstance?.eventSocket.exists).toBe(true);

      const cmdOnlyInstance = result.instances.find((i) => i.signature === "def456789abc");
      expect(cmdOnlyInstance?.commandSocket.exists).toBe(true);
      expect(cmdOnlyInstance?.eventSocket.exists).toBe(false);

      const evtOnlyInstance = result.instances.find((i) => i.signature === "0fedcba98765");
      expect(evtOnlyInstance?.commandSocket.exists).toBe(false);
      expect(evtOnlyInstance?.eventSocket.exists).toBe(true);
    });
  });

  describe("environment edge cases", () => {
    it("should handle instance signature change during runtime", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;

      // Create multiple instances
      await createRealisticHyprlandInstance("abc123456789");
      await createRealisticHyprlandInstance("def456789abc");

      // First discovery with first instance active
      process.env.HYPRLAND_INSTANCE_SIGNATURE = "abc123456789";
      const result1 = await discoverSockets({ useCache: false });

      expect(result1.activeInstance?.signature).toBe("abc123456789");

      // Change active instance
      process.env.HYPRLAND_INSTANCE_SIGNATURE = "def456789abc";
      const result2 = await discoverSockets({ useCache: false });

      expect(result2.activeInstance?.signature).toBe("def456789abc");
      expect(result2.instances).toHaveLength(2); // Both instances still present
    });

    it("should handle missing XDG_RUNTIME_DIR gracefully", async () => {
      process.env.XDG_RUNTIME_DIR = undefined;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = undefined;

      const result = await discoverSockets();

      expect(result.success).toBe(false);
      expect(result.error).toContain("No Hyprland instances found");
      expect(result.instances).toHaveLength(0);
    });

    it("should handle corrupted instance directories", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;

      // Create valid instance
      await createRealisticHyprlandInstance("abc123456789");

      // Create corrupted instance directory (file instead of directory)
      const corruptedPath = join(testHyprDir, "notvalidhex");
      await writeFile(corruptedPath, "not a directory");

      // Create directory without proper sockets
      const emptyInstanceDir = join(testHyprDir, "0123456789ab");
      await mkdir(emptyInstanceDir);

      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1); // Only the valid instance
      expect(result.instances[0].signature).toBe("abc123456789");
    });
  });

  describe("performance and caching integration", () => {
    it("should maintain performance with many instances", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;

      // Create realistic number of instances (typical multi-user system)
      const instanceCount = 10;
      const instances = [];

      for (let i = 0; i < instanceCount; i++) {
        const signature = `${i.toString(16).padStart(16, "0")}`;
        instances.push(signature);
        await createRealisticHyprlandInstance(signature);
      }

      process.env.HYPRLAND_INSTANCE_SIGNATURE = instances[0];

      const startTime = Date.now();
      const result = await discoverSockets();
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(instanceCount);
      expect(duration).toBeLessThan(500); // Should be fast even with many instances
    });

    it("should cache correctly across multiple access patterns", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      const signature = "abc123456789";

      await createRealisticHyprlandInstance(signature);
      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;

      // Test different access patterns
      const directResult = await discoverSockets({ useCache: true });
      const socketsResult = await getActiveSockets({ useCache: true });
      const listResult = await listInstances({ useCache: true });

      expect(directResult.success).toBe(true);
      expect(socketsResult).toBeDefined();
      expect(listResult).toHaveLength(1);

      // All should reference the same instance
      expect(directResult.activeInstance?.signature).toBe(signature);
      expect(socketsResult?.command).toContain(`${signature}.socket.sock`);
      expect(listResult[0].signature).toBe(signature);
    });
  });

  describe("realistic workflow integration", () => {
    it("should handle typical Hyprland startup sequence", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;

      // Initially no instances
      let result = await discoverSockets();
      expect(result.success).toBe(false);

      // Hyprland starts - creates instance
      const signature = "abc123456789";
      await createRealisticHyprlandInstance(signature, {
        commandSocket: true,
        eventSocket: false, // Event socket created after command socket
      });

      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;

      result = await discoverSockets({ useCache: false });
      expect(result.success).toBe(true);
      expect(result.activeInstance?.commandSocket.exists).toBe(true);
      expect(result.activeInstance?.eventSocket.exists).toBe(false);

      // Event socket becomes available
      const evtPath = join(testHyprDir, signature, `${signature}.socket2.sock`);
      await writeFile(evtPath, "");
      await chmod(evtPath, 0o600);

      result = await discoverSockets({ useCache: false });
      expect(result.success).toBe(true);
      expect(result.activeInstance?.commandSocket.exists).toBe(true);
      expect(result.activeInstance?.eventSocket.exists).toBe(true);

      // Verify sockets are usable
      const sockets = await getActiveSockets({ useCache: false });
      expect(sockets).toBeDefined();
      expect(sockets?.command).toBeTruthy();
      expect(sockets?.event).toBeTruthy();
    });

    it("should handle Hyprland shutdown sequence", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      const signature = "abc123456789";

      // Setup running instance
      await createRealisticHyprlandInstance(signature);
      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;

      let result = await discoverSockets({ useCache: false });
      expect(result.success).toBe(true);
      expect(result.activeInstance?.signature).toBe(signature);

      // Simulate socket removal (Hyprland shutdown)
      const cmdPath = join(testHyprDir, signature, `${signature}.socket.sock`);
      const evtPath = join(testHyprDir, signature, `${signature}.socket2.sock`);

      await unlink(cmdPath);
      await unlink(evtPath);

      result = await discoverSockets({ useCache: false });
      expect(result.success).toBe(false);
      expect(result.instances).toHaveLength(0);

      const sockets = await getActiveSockets({ useCache: false });
      expect(sockets).toBeUndefined();
    });

    it("should handle concurrent instance management", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;

      // Setup initial instance
      const primary = "abc123456789";
      await createRealisticHyprlandInstance(primary);
      process.env.HYPRLAND_INSTANCE_SIGNATURE = primary;

      let result = await discoverSockets({ useCache: false });
      expect(result.instances).toHaveLength(1);
      expect(result.activeInstance?.signature).toBe(primary);

      // Add secondary instance (new Hyprland process)
      const secondary = "def456789abc";
      await createRealisticHyprlandInstance(secondary);

      result = await discoverSockets({ useCache: false });
      expect(result.instances).toHaveLength(2);
      expect(result.activeInstance?.signature).toBe(primary); // Primary still active

      // Switch to secondary instance
      process.env.HYPRLAND_INSTANCE_SIGNATURE = secondary;
      result = await discoverSockets({ useCache: false });
      expect(result.instances).toHaveLength(2);
      expect(result.activeInstance?.signature).toBe(secondary);

      // Remove primary instance
      await unlink(join(testHyprDir, primary, `${primary}.socket.sock`));
      await unlink(join(testHyprDir, primary, `${primary}.socket2.sock`));
      await rmdir(join(testHyprDir, primary));

      result = await discoverSockets({ useCache: false });
      expect(result.instances).toHaveLength(1);
      expect(result.activeInstance?.signature).toBe(secondary);
    });
  });

  describe("error recovery integration", () => {
    it("should recover from temporary filesystem issues", async () => {
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      const signature = "abc123456789";

      await createRealisticHyprlandInstance(signature);
      process.env.HYPRLAND_INSTANCE_SIGNATURE = signature;

      // Normal operation
      let result = await discoverSockets({ useCache: false });
      expect(result.success).toBe(true);

      // Simulate temporary permission issue
      const instanceDir = join(testHyprDir, signature);
      await chmod(instanceDir, 0o000);

      result = await discoverSockets({ useCache: false });
      expect(result.success).toBe(false);

      // Restore permissions
      await chmod(instanceDir, 0o755);

      result = await discoverSockets({ useCache: false });
      expect(result.success).toBe(true);
      expect(result.activeInstance?.signature).toBe(signature);
    });

    it("should provide helpful error messages in real scenarios", async () => {
      // Test common error scenarios users might encounter

      // No XDG_RUNTIME_DIR - should fall back to /tmp/hypr
      process.env.XDG_RUNTIME_DIR = undefined;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = undefined;
      clearSocketCache(); // Clear cache to ensure fresh results

      let result = await discoverSockets({ useCache: false });
      expect(result.error).toContain("No Hyprland instances found");
      expect(result.error).toContain("Ensure Hyprland is running");
      expect(result.error).toContain("/tmp/hypr"); // Should reference fallback directory

      // Hyprland not running (runtime dir exists but no instances)
      // The testHyprDir should already exist from beforeEach, so this test should work
      process.env.XDG_RUNTIME_DIR = testRuntimeDir;
      process.env.HYPRLAND_INSTANCE_SIGNATURE = undefined;
      clearSocketCache(); // Clear cache to ensure fresh results

      result = await discoverSockets({ useCache: false });
      expect(result.error).toContain("No Hyprland instances found");
      expect(result.error).toContain(testHyprDir);
    });
  });
});
