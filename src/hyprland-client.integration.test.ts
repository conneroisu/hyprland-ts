/**
 * @file Integration tests for HyprlandClient class
 *
 * These tests verify end-to-end functionality with actual Hyprland instances
 * when available. Tests gracefully skip when Hyprland is not running.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientState, HyprlandClient, type HyprlandClientConfig } from "./hyprland-client.js";
import { discoverSockets } from "./socket-discovery.js";
import type { HyprlandEventData } from "./types.js";

// ============================================================================
// Test Setup and Utilities
// ============================================================================

/**
 * Checks if Hyprland is running and accessible for integration tests.
 */
async function isHyprlandAvailable(): Promise<boolean> {
  try {
    const result = await discoverSockets({ validatePermissions: true });
    return result.success && result.activeInstance !== undefined;
  } catch {
    return false;
  }
}

/**
 * Creates a test client with sensible defaults for integration testing.
 */
function createTestClient(config: HyprlandClientConfig = {}): HyprlandClient {
  return new HyprlandClient({
    connection: {
      timeout: 5000,
      autoReconnect: false, // Disable for predictable test behavior
      healthCheckInterval: 0, // Disable periodic checks
    },
    lifecycle: {
      enableResourceMonitoring: false, // Reduce test noise
    },
    monitoring: {
      enabled: false, // Reduce test overhead
    },
    capabilities: {
      autoDetect: true, // Test capability detection
    },
    ...config,
  });
}

describe("HyprlandClient Integration Tests", () => {
  let client: HyprlandClient;
  let isHyprlandRunning: boolean;

  beforeEach(async () => {
    // Check if Hyprland is available for integration tests
    isHyprlandRunning = await isHyprlandAvailable();

    if (!isHyprlandRunning) {
      console.warn("Skipping integration tests - Hyprland not available");
    }
  });

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ============================================================================
  // Connection and Discovery Tests
  // ============================================================================

  describe("connection and discovery", () => {
    it("should discover and connect to running Hyprland instance", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();

      expect(client.state).toBe(ClientState.Disconnected);
      expect(client.isConnected).toBe(false);

      await client.connect();

      expect(client.state).toBe(ClientState.Connected);
      expect(client.isConnected).toBe(true);
      expect(client.clientCapabilities).not.toBeNull();
    });

    it("should handle connection events", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();

      const connectPromise = new Promise<void>((resolve) => {
        client.once("connected", () => resolve());
      });

      await client.connect();
      await connectPromise;

      expect(client.isConnected).toBe(true);
    });

    it("should provide accurate health information when connected", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();
      await client.connect();

      const health = client.getHealth();

      expect(health.status).toBe("healthy");
      expect(health.commandHealth).toBe("healthy");
      expect(health.eventHealth).toBe("healthy");
      expect(health.uptime).toBeGreaterThan(0);
      expect(health.issues).toHaveLength(0);
    });

    it("should detect Hyprland capabilities", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();

      const capabilityPromise = new Promise<void>((resolve) => {
        client.once("capabilitiesDetected", () => resolve());
      });

      await client.connect();
      await capabilityPromise;

      const capabilities = client.clientCapabilities;
      expect(capabilities).not.toBeNull();
      expect(capabilities?.version).toBeTruthy();
      expect(capabilities?.supportedCommands).toContain("clients");
      expect(capabilities?.supportedCommands).toContain("workspaces");
      expect(capabilities?.supportedEvents).toContain("workspace");
      expect(capabilities?.features.batchCommands).toBe(true);
    });
  });

  // ============================================================================
  // Command Execution Tests
  // ============================================================================

  describe("command execution", () => {
    beforeEach(async () => {
      if (!isHyprlandRunning) return;
      client = createTestClient();
      await client.connect();
    });

    it("should execute version command successfully", async () => {
      if (!isHyprlandRunning) return;

      const version = await client.executeCommand<string>("version");

      expect(typeof version).toBe("string");
      expect(version).toContain("Hyprland");
    });

    it("should execute clients command and return valid data", async () => {
      if (!isHyprlandRunning) return;

      const clients = await client.executeCommand("clients", [], { json: true });

      expect(Array.isArray(clients)).toBe(true);
      // Each client should have expected properties
      if (Array.isArray(clients) && clients.length > 0) {
        const client = clients[0];
        expect(client).toHaveProperty("class");
        expect(client).toHaveProperty("title");
        expect(client).toHaveProperty("pid");
      }
    });

    it("should execute workspaces command and return valid data", async () => {
      if (!isHyprlandRunning) return;

      const workspaces = await client.executeCommand("workspaces", [], { json: true });

      expect(Array.isArray(workspaces)).toBe(true);
      // Each workspace should have expected properties
      if (Array.isArray(workspaces) && workspaces.length > 0) {
        const workspace = workspaces[0];
        expect(workspace).toHaveProperty("id");
        expect(workspace).toHaveProperty("name");
      }
    });

    it("should execute monitors command and return valid data", async () => {
      if (!isHyprlandRunning) return;

      const monitors = await client.executeCommand("monitors", [], { json: true });

      expect(Array.isArray(monitors)).toBe(true);
      // Each monitor should have expected properties
      if (Array.isArray(monitors) && monitors.length > 0) {
        const monitor = monitors[0];
        expect(monitor).toHaveProperty("name");
        expect(monitor).toHaveProperty("width");
        expect(monitor).toHaveProperty("height");
      }
    });

    it("should handle command execution errors gracefully", async () => {
      if (!isHyprlandRunning) return;

      await expect(client.executeCommand("nonexistent_command")).rejects.toThrow();
    });

    it("should respect command timeouts", async () => {
      if (!isHyprlandRunning) return;

      // Test with very short timeout
      await expect(client.executeCommand("version", [], { timeout: 1 })).rejects.toThrow();
    });
  });

  // ============================================================================
  // Event Subscription Tests
  // ============================================================================

  describe("event subscription", () => {
    beforeEach(async () => {
      if (!isHyprlandRunning) return;
      client = createTestClient();
      await client.connect();
    });

    it("should subscribe to workspace events", async () => {
      if (!isHyprlandRunning) return;

      const events: HyprlandEventData[] = [];
      const subscription = await client.subscribe("workspace", (event) => {
        events.push(event);
      });

      expect(subscription).toHaveProperty("unsubscribe");
      expect(typeof subscription.unsubscribe).toBe("function");

      // Clean up subscription
      subscription.unsubscribe();
    });

    it("should subscribe to multiple event types", async () => {
      if (!isHyprlandRunning) return;

      const events: HyprlandEventData[] = [];
      const subscription = await client.subscribe(
        ["workspace", "activewindow", "focusedmon"],
        (event) => {
          events.push(event);
        }
      );

      expect(subscription).toHaveProperty("unsubscribe");

      // Clean up subscription
      subscription.unsubscribe();
    });

    it("should handle event subscription with filters", async () => {
      if (!isHyprlandRunning) return;

      const filteredEvents: HyprlandEventData[] = [];
      const subscription = await client.subscribe(
        "workspace",
        (event) => {
          filteredEvents.push(event);
        },
        {
          filter: (event: unknown) =>
            (event as { id?: number }).id ? (event as { id: number }).id > 0 : false,
        }
      );

      // Clean up subscription
      subscription.unsubscribe();
    });

    it("should handle event subscription with transforms", async () => {
      if (!isHyprlandRunning) return;

      const transformedEvents: HyprlandEventData[] = [];
      const subscription = await client.subscribe(
        "workspace",
        (event) => {
          transformedEvents.push(event);
        },
        {
          transform: (event: unknown) => ({ ...(event as object), transformed: true }),
        }
      );

      // Clean up subscription
      subscription.unsubscribe();
    });

    it("should properly unsubscribe from events", async () => {
      if (!isHyprlandRunning) return;

      const events: HyprlandEventData[] = [];
      const subscription = await client.subscribe("workspace", (event) => {
        events.push(event);
      });

      // Unsubscribe should not throw
      expect(() => subscription.unsubscribe()).not.toThrow();
    });
  });

  // ============================================================================
  // Health and Monitoring Tests
  // ============================================================================

  describe("health and monitoring", () => {
    beforeEach(async () => {
      if (!isHyprlandRunning) return;
      client = createTestClient();
      await client.connect();
    });

    it("should provide accurate health status", async () => {
      if (!isHyprlandRunning) return;

      const health = client.getHealth();

      expect(health.status).toBe("healthy");
      expect(health.commandHealth).toBe("healthy");
      expect(health.eventHealth).toBe("healthy");
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.lastCheck).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(health.issues)).toBe(true);
    });

    it("should collect meaningful metrics", async () => {
      if (!isHyprlandRunning) return;

      // Execute a few commands to generate metrics
      await client.executeCommand("version");
      await client.executeCommand("clients");

      const metrics = client.getMetrics();

      expect(metrics.uptime).toBeGreaterThan(0);
      expect(metrics.connection.totalConnections).toBe(1);
      expect(metrics.connection.failedConnections).toBe(0);
      expect(metrics.commands.totalExecuted).toBeGreaterThan(0);
      expect(metrics.commands.successfulCommands).toBeGreaterThan(0);
      expect(metrics.events.activeSubscriptions).toBeGreaterThanOrEqual(0);
    });

    it("should provide comprehensive client status", async () => {
      if (!isHyprlandRunning) return;

      const status = client.getClientStatus();

      expect(status.state).toBe(ClientState.Connected);
      expect(status.health.status).toBe("healthy");
      expect(status.capabilities).not.toBeNull();
      expect(status.uptime).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Lifecycle and Cleanup Tests
  // ============================================================================

  describe("lifecycle and cleanup", () => {
    it("should perform graceful shutdown", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();
      await client.connect();

      expect(client.isConnected).toBe(true);

      const disconnectPromise = new Promise<void>((resolve) => {
        client.once("disconnected", () => resolve());
      });

      await client.disconnect();
      await disconnectPromise;

      expect(client.state).toBe(ClientState.Disconnected);
      expect(client.isConnected).toBe(false);
    });

    it("should handle rapid connect/disconnect cycles", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();

      // Perform multiple connect/disconnect cycles
      for (let i = 0; i < 3; i++) {
        await client.connect();
        expect(client.isConnected).toBe(true);

        await client.disconnect();
        expect(client.isConnected).toBe(false);
      }
    });

    it("should clean up resources properly", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();
      await client.connect();

      // Create subscriptions
      const _subscription1 = await client.subscribe("workspace", () => {
        // No-op handler for resource testing
      });
      const _subscription2 = await client.subscribe("activewindow", () => {
        // No-op handler for resource testing
      });

      // Execute commands
      await client.executeCommand("version");
      await client.executeCommand("clients");

      // Verify resources are active
      const healthBefore = client.getHealth();
      expect(healthBefore.status).toBe("healthy");

      // Disconnect and verify cleanup
      await client.disconnect();

      expect(client.state).toBe(ClientState.Disconnected);
      expect(client.isConnected).toBe(false);
    });
  });

  // ============================================================================
  // Error Handling and Edge Cases
  // ============================================================================

  describe("error handling and edge cases", () => {
    it("should handle connection to non-existent socket gracefully", async () => {
      client = createTestClient({
        sockets: {
          command: "/tmp/nonexistent.sock",
          event: "/tmp/nonexistent2.sock",
        },
      });

      await expect(client.connect()).rejects.toThrow();
      expect(client.state).toBe(ClientState.Error);
    });

    it("should reject operations when not connected", async () => {
      client = createTestClient();

      await expect(client.executeCommand("version")).rejects.toThrow();
      await expect(
        client.subscribe("workspace", () => {
          // No-op handler for error testing
        })
      ).rejects.toThrow();
    });

    it("should handle malformed commands gracefully", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();
      await client.connect();

      // Test with invalid command arguments
      await expect(
        client.executeCommand("dispatch", ["invalid_dispatch_command"])
      ).rejects.toThrow();
    });

    it("should maintain stability after errors", async () => {
      if (!isHyprlandRunning) return;

      client = createTestClient();
      await client.connect();

      // Cause an error
      try {
        await client.executeCommand("nonexistent_command");
      } catch {
        // Expected
      }

      // Verify client is still functional
      expect(client.isConnected).toBe(true);

      const version = await client.executeCommand("version");
      expect(typeof version).toBe("string");
    });
  });

  // ============================================================================
  // Performance and Stress Tests
  // ============================================================================

  describe("performance and stress tests", () => {
    beforeEach(async () => {
      if (!isHyprlandRunning) return;
      client = createTestClient();
      await client.connect();
    });

    it("should handle multiple concurrent commands", async () => {
      if (!isHyprlandRunning) return;

      const commandPromises = Array.from({ length: 10 }, (_, i) =>
        client.executeCommand("version").then((result) => ({ index: i, result }))
      );

      const results = await Promise.all(commandPromises);

      expect(results).toHaveLength(10);
      results.forEach((result, index) => {
        expect(result.index).toBe(index);
        expect(typeof result.result).toBe("string");
      });
    });

    it("should handle multiple concurrent subscriptions", async () => {
      if (!isHyprlandRunning) return;

      const subscriptionPromises = Array.from({ length: 5 }, (_, i) =>
        client
          .subscribe("workspace", () => {
            // No-op handler for concurrent subscription testing
          })
          .then((sub) => ({ index: i, subscription: sub }))
      );

      const subscriptions = await Promise.all(subscriptionPromises);

      expect(subscriptions).toHaveLength(5);

      // Clean up subscriptions
      for (const { subscription } of subscriptions) {
        subscription.unsubscribe();
      }
    });

    it("should maintain performance under load", async () => {
      if (!isHyprlandRunning) return;

      const startTime = Date.now();

      // Execute many commands rapidly
      const promises = Array.from({ length: 50 }, () => client.executeCommand("version"));

      await Promise.all(promises);

      const duration = Date.now() - startTime;
      const commandsPerSecond = 50 / (duration / 1000);

      // Should handle at least 10 commands per second
      expect(commandsPerSecond).toBeGreaterThan(10);
    });
  });
});
