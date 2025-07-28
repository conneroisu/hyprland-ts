/**
 * Integration tests for HyprCtl command execution system.
 *
 * These tests run against actual Hyprland instances to verify real-world
 * compatibility and functionality.
 *
 * Tests are conditionally executed based on Hyprland availability.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HyprCtlCommandBuilder } from "./hyprctl-builder.js";
import { HyprCtlClient } from "./hyprctl-client.js";
import { VersionCompatibilityManager } from "./hyprctl-version.js";
import { discoverSockets } from "./socket-discovery.js";
import type { HyprlandMonitor, HyprlandWindow, HyprlandWorkspace } from "./types.js";

// ============================================================================
// Test Configuration
// ============================================================================

const INTEGRATION_TIMEOUT = 10000; // 10 seconds for real Hyprland operations

let hyprlandAvailable = false;
let socketPath: string;
let client: HyprCtlClient;
let builder: HyprCtlCommandBuilder;
let versionManager: VersionCompatibilityManager;

// ============================================================================
// Setup and Teardown
// ============================================================================

beforeAll(async () => {
  try {
    // Discover active Hyprland instance
    const sockets = await discoverSockets();
    if (sockets.length > 0 && sockets[0].command) {
      socketPath = sockets[0].command;
      hyprlandAvailable = true;

      // Initialize client and related components
      client = new HyprCtlClient({
        socketPath,
        commandTimeout: 5000,
        enableCaching: true,
        enableHistory: true,
        enableMonitoring: true,
      });

      builder = new HyprCtlCommandBuilder(client);
      versionManager = new VersionCompatibilityManager(client);

      console.log(`Using Hyprland socket: ${socketPath}`);
    } else {
      console.log("No active Hyprland instance found, skipping integration tests");
    }
  } catch (error) {
    console.log(`Failed to discover Hyprland: ${error}, skipping integration tests`);
  }
}, INTEGRATION_TIMEOUT);

afterAll(async () => {
  if (client) {
    await client.close();
  }
});

beforeEach(() => {
  if (client) {
    client.clearCache();
    client.clearHistory();
  }
});

// ============================================================================
// Integration Test Suite
// ============================================================================

describe.runIf(hyprlandAvailable)("HyprCtl Integration Tests", () => {
  // ========================================================================
  // Basic Command Execution
  // ========================================================================

  describe("Basic Command Execution", () => {
    it(
      "should get list of clients",
      async () => {
        const result = await client.executeCommand<HyprlandWindow[]>("clients");

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.executionTime).toBeGreaterThan(0);
        expect(result.fromCache).toBe(false);

        // Verify window structure if windows exist
        if (result.data && result.data.length > 0) {
          const window = result.data[0];
          expect(window).toHaveProperty("address");
          expect(window).toHaveProperty("class");
          expect(window).toHaveProperty("title");
          expect(window).toHaveProperty("workspace");
          expect(window).toHaveProperty("at");
          expect(window).toHaveProperty("size");
        }
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should get list of workspaces",
      async () => {
        const result = await client.executeCommand<HyprlandWorkspace[]>("workspaces");

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);

        if (result.data && result.data.length > 0) {
          const workspace = result.data[0];
          expect(workspace).toHaveProperty("id");
          expect(workspace).toHaveProperty("name");
        }
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should get list of monitors",
      async () => {
        const result = await client.executeCommand<HyprlandMonitor[]>("monitors");

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.data?.length).toBeGreaterThan(0); // At least one monitor should exist

        const monitor = result.data?.[0];
        expect(monitor).toHaveProperty("id");
        expect(monitor).toHaveProperty("name");
        expect(monitor).toHaveProperty("width");
        expect(monitor).toHaveProperty("height");
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should get cursor position",
      async () => {
        const result = await client.executeCommand("cursorpos");

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should get system devices",
      async () => {
        const result = await client.executeCommand("devices");

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should handle command with arguments",
      async () => {
        const result = await client.executeCommand("getoption", ["general:border_size"]);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.args).toEqual(["general:border_size"]);
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Command Builder Integration
  // ========================================================================

  describe("Command Builder Integration", () => {
    it(
      "should execute commands through builder",
      async () => {
        const result = await builder.windows.list().execute();

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(Array.isArray(result.data)).toBe(true);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should execute system commands through builder",
      async () => {
        const result = await builder.system.cursorPosition().execute();

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should execute commands with options",
      async () => {
        const result = await builder.monitors
          .list()
          .withTimeout(3000)
          .withPriority("high")
          .withContext("integration-test")
          .execute();

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should skip cache when requested",
      async () => {
        // First call
        await builder.workspaces.list().execute();

        // Second call with skip cache
        const result = await builder.workspaces.list().skipCache().execute();

        expect(result.fromCache).toBe(false);
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Batch Execution Integration
  // ========================================================================

  describe("Batch Execution Integration", () => {
    it(
      "should execute multiple commands in batch",
      async () => {
        const commands = [
          { command: "clients" as const },
          { command: "workspaces" as const },
          { command: "monitors" as const },
        ];

        const result = await client.executeBatch(commands);

        expect(result.success).toBe(true);
        expect(result.results).toHaveLength(3);
        expect(result.successCount).toBe(3);
        expect(result.errorCount).toBe(0);
        expect(result.totalExecutionTime).toBeGreaterThan(0);

        // Verify individual results
        for (const commandResult of result.results) {
          expect(commandResult.success).toBe(true);
          expect(commandResult.data).toBeDefined();
        }
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should execute batch commands in parallel",
      async () => {
        const commands = [{ command: "clients" as const }, { command: "workspaces" as const }];

        const startTime = Date.now();
        const result = await client.executeBatch(commands, { parallel: true });
        const duration = Date.now() - startTime;

        expect(result.success).toBe(true);
        expect(result.results).toHaveLength(2);

        // Parallel execution should be faster than sequential
        // (This is a rough check - timing can vary)
        expect(duration).toBeLessThan(result.totalExecutionTime * 1.5);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should handle mixed command types in batch",
      async () => {
        const commands = [
          { command: "clients" as const },
          { command: "dispatch" as const, args: ["workspace" as const, "1"] },
          { command: "workspaces" as const },
        ];

        const result = await client.executeBatch(commands);

        // At least the query commands should succeed
        expect(result.successCount).toBeGreaterThanOrEqual(2);
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Caching Integration
  // ========================================================================

  describe("Caching Integration", () => {
    it(
      "should cache results from real commands",
      async () => {
        // First call - should not be cached
        const result1 = await client.executeCommand("monitors");
        expect(result1.fromCache).toBe(false);

        // Second call - should be cached
        const result2 = await client.executeCommand("monitors");
        expect(result2.fromCache).toBe(true);
        expect(result2.data).toEqual(result1.data);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should respect cache TTL with real commands",
      async () => {
        const shortCacheClient = new HyprCtlClient({
          socketPath,
          cacheTtl: 100, // Very short TTL
          enableCaching: true,
        });

        try {
          // First call
          await shortCacheClient.executeCommand("cursorpos");

          // Wait for cache to expire
          await new Promise((resolve) => setTimeout(resolve, 150));

          // Second call should not be cached
          const result = await shortCacheClient.executeCommand("cursorpos");
          expect(result.fromCache).toBe(false);
        } finally {
          await shortCacheClient.close();
        }
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Version Compatibility Integration
  // ========================================================================

  describe("Version Compatibility Integration", () => {
    it(
      "should detect Hyprland version",
      async () => {
        const versionInfo = await versionManager.detectVersion();

        expect(versionInfo).toBeDefined();
        expect(versionInfo.version).toBeDefined();
        expect(versionInfo.version.major).toBeGreaterThanOrEqual(0);
        expect(versionInfo.version.minor).toBeGreaterThanOrEqual(20);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should check command compatibility",
      async () => {
        const isSupported = await versionManager.isCommandSupported("clients");
        expect(isSupported).toBe(true);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should generate compatibility report",
      async () => {
        const report = await versionManager.getCompatibilityReport();

        expect(report.version).toBeDefined();
        expect(report.supportedCommands).toBeDefined();
        expect(report.supportedCommands.length).toBeGreaterThan(0);
        expect(report.supportedFeatures).toBeDefined();
        expect(report.unsupportedCommands).toBeDefined();
        expect(report.unsupportedFeatures).toBeDefined();
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Performance and Monitoring Integration
  // ========================================================================

  describe("Performance and Monitoring Integration", () => {
    it(
      "should track performance metrics",
      async () => {
        // Execute several commands
        await client.executeCommand("clients");
        await client.executeCommand("workspaces");
        await client.executeCommand("monitors");

        const metrics = client.getMetrics();

        expect(metrics.totalCommands).toBe(3);
        expect(metrics.successfulCommands).toBe(3);
        expect(metrics.failedCommands).toBe(0);
        expect(metrics.averageExecutionTime).toBeGreaterThan(0);
        expect(metrics.commandsPerSecond).toBeGreaterThan(0);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should track command history",
      async () => {
        await client.executeCommand("clients");
        await client.executeCommand("workspaces");

        const history = client.getHistory();

        expect(history).toHaveLength(2);
        expect(history[0].command).toBe("clients");
        expect(history[1].command).toBe("workspaces");
        expect(history[0].success).toBe(true);
        expect(history[1].success).toBe(true);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should handle rate limiting gracefully",
      async () => {
        const rateLimitedClient = new HyprCtlClient({
          socketPath,
          maxCommandsPerSecond: 2, // Very low rate limit
        });

        try {
          const startTime = Date.now();

          // Execute multiple commands rapidly
          const promises = [
            rateLimitedClient.executeCommand("clients"),
            rateLimitedClient.executeCommand("workspaces"),
            rateLimitedClient.executeCommand("monitors"),
          ];

          const results = await Promise.all(promises);
          const duration = Date.now() - startTime;

          // All commands should succeed
          for (const result of results) {
            expect(result.success).toBe(true);
          }

          // Should take some time due to rate limiting
          expect(duration).toBeGreaterThan(500); // At least 500ms for rate limiting
        } finally {
          await rateLimitedClient.close();
        }
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Error Handling Integration
  // ========================================================================

  describe("Error Handling Integration", () => {
    it(
      "should handle invalid commands gracefully",
      async () => {
        await expect(client.executeCommand("nonexistent_command" as never)).rejects.toThrow();
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should handle invalid command arguments",
      async () => {
        await expect(client.executeCommand("getoption", ["nonexistent:option"])).rejects.toThrow();
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should handle network issues gracefully",
      async () => {
        const badClient = new HyprCtlClient({
          socketPath: "/tmp/nonexistent-socket.sock",
          commandTimeout: 1000,
        });

        try {
          await expect(badClient.executeCommand("clients")).rejects.toThrow();
        } finally {
          await badClient.close();
        }
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Event Integration
  // ========================================================================

  describe("Event Integration", () => {
    it(
      "should emit events during real command execution",
      async () => {
        const events: unknown[] = [];

        client.on("command", (event) => events.push(event));

        await client.executeCommand("clients");

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: "success",
          command: "clients",
          executionId: expect.any(String),
        });
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should emit batch events",
      async () => {
        const events: unknown[] = [];

        client.on("batch", (event) => events.push(event));

        const commands = [{ command: "clients" as const }, { command: "workspaces" as const }];

        await client.executeBatch(commands);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: "success",
          commands: 2,
        });
      },
      INTEGRATION_TIMEOUT
    );
  });

  // ========================================================================
  // Real-world Usage Patterns
  // ========================================================================

  describe("Real-world Usage Patterns", () => {
    it(
      "should handle typical client workflow",
      async () => {
        // 1. Get current windows
        const windows = await builder.windows.list().execute();
        expect(windows.success).toBe(true);

        // 2. Get current workspaces
        const workspaces = await builder.workspaces.list().execute();
        expect(workspaces.success).toBe(true);

        // 3. Get monitors
        const monitors = await builder.monitors.list().execute();
        expect(monitors.success).toBe(true);

        // 4. Check system info
        const devices = await builder.system.devices().execute();
        expect(devices.success).toBe(true);

        // Verify metrics after workflow
        const metrics = client.getMetrics();
        expect(metrics.totalCommands).toBe(4);
        expect(metrics.successfulCommands).toBe(4);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should handle rapid successive queries",
      async () => {
        const promises = Array.from({ length: 10 }, () => client.executeCommand("cursorpos"));

        const results = await Promise.all(promises);

        // All should succeed
        for (const result of results) {
          expect(result.success).toBe(true);
        }

        // Some should be cached (except the first one)
        const cachedResults = results.filter((r) => r.fromCache);
        expect(cachedResults.length).toBeGreaterThan(0);
      },
      INTEGRATION_TIMEOUT
    );

    it(
      "should maintain performance under load",
      async () => {
        const startTime = Date.now();

        // Execute many commands
        const promises = Array.from({ length: 20 }, (_, i) => {
          const commands = ["clients", "workspaces", "monitors", "cursorpos"];
          const command = commands[i % commands.length] as
            | "clients"
            | "workspaces"
            | "monitors"
            | "cursorpos";
          return client.executeCommand(command);
        });

        const results = await Promise.all(promises);
        const duration = Date.now() - startTime;

        // All should succeed
        const successCount = results.filter((r) => r.success).length;
        expect(successCount).toBe(20);

        // Should complete in reasonable time (accounting for caching)
        expect(duration).toBeLessThan(5000);

        // Check final metrics
        const metrics = client.getMetrics();
        expect(metrics.totalCommands).toBe(20);
        expect(metrics.cacheHitRate).toBeGreaterThan(0);
      },
      INTEGRATION_TIMEOUT
    );
  });
});

// ============================================================================
// Conditional Test Skip Message
// ============================================================================

describe.skipIf(!hyprlandAvailable)("HyprCtl Integration Tests (Skipped)", () => {
  it("should skip integration tests when Hyprland is not available", () => {
    console.log("Skipping HyprCtl integration tests - no active Hyprland instance detected");
    expect(true).toBe(true);
  });
});
