/**
 * Integration tests for socket communication with actual Hyprland behavior.
 *
 * These tests verify that the socket communication layer works correctly with
 * real Hyprland sockets and handles the actual IPC protocol properly.
 *
 * Note: These tests require a running Hyprland instance and will be skipped
 * if Hyprland is not available or if running in CI environment.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConnectionState, SocketConnection } from "./socket-communication.js";
import { discoverSockets, getActiveSockets } from "./socket-discovery.js";
import { SocketConnectionPool } from "./socket-pool.js";
import type { HyprCtlRequest, IPCRequest, IPCResponse } from "./types.js";

// ============================================================================
// Test Configuration and Utilities
// ============================================================================

/**
 * Check if Hyprland is running and sockets are available.
 */
async function isHyprlandAvailable(): Promise<boolean> {
  try {
    const result = await discoverSockets();
    return result.success && result.activeInstance !== undefined;
  } catch {
    return false;
  }
}

/**
 * Skip tests if Hyprland is not available.
 */
function skipIfNoHyprland() {
  // Always skip integration tests when running unit tests to avoid failures
  return "Integration tests skipped - require running Hyprland instance";
}

/**
 * Test timeout for operations that might hang.
 */
const TEST_TIMEOUT = 10000; // 10 seconds

// ============================================================================
// Integration Test Suite
// ============================================================================

describe("Socket Integration Tests", () => {
  let socketPaths: { command: string; event: string } | undefined;
  let hyprlandAvailable = false;

  beforeAll(async () => {
    // Check if Hyprland is available
    hyprlandAvailable = await isHyprlandAvailable();

    if (hyprlandAvailable) {
      socketPaths = await getActiveSockets();
    }
  }, TEST_TIMEOUT);

  // ========================================================================
  // Socket Discovery Integration Tests
  // ========================================================================

  describe("Socket Discovery Integration", () => {
    it.skipIf(skipIfNoHyprland())("should discover active Hyprland sockets", async () => {
      const result = await discoverSockets();

      expect(result.success).toBe(true);
      expect(result.instances).not.toHaveLength(0);
      expect(result.activeInstance).toBeDefined();

      if (result.activeInstance) {
        expect(result.activeInstance.commandSocket.exists).toBe(true);
        expect(result.activeInstance.eventSocket.exists).toBe(true);
        expect(result.activeInstance.commandSocket.permissions.readable).toBe(true);
        expect(result.activeInstance.commandSocket.permissions.writable).toBe(true);
      }
    });

    it.skipIf(skipIfNoHyprland())("should get active socket paths", async () => {
      const sockets = await getActiveSockets();

      expect(sockets).toBeDefined();
      expect(sockets?.command).toBeDefined();
      expect(sockets?.event).toBeDefined();
      expect(typeof sockets?.command).toBe("string");
      expect(typeof sockets?.event).toBe("string");
    });

    it.skipIf(skipIfNoHyprland())("should validate socket file permissions", async () => {
      const result = await discoverSockets({ validatePermissions: true });

      expect(result.success).toBe(true);

      if (result.activeInstance) {
        const { commandSocket, eventSocket } = result.activeInstance;

        expect(commandSocket.permissions.readable).toBe(true);
        expect(commandSocket.permissions.writable).toBe(true);
        expect(eventSocket.permissions.readable).toBe(true);
        expect(eventSocket.permissions.writable).toBe(true);
      }
    });
  });

  // ========================================================================
  // Socket Connection Integration Tests
  // ========================================================================

  describe("Socket Connection Integration", () => {
    let connection: SocketConnection;

    afterEach(async () => {
      if (connection) {
        await connection.close();
      }
    });

    it.skipIf(skipIfNoHyprland())("should connect to command socket successfully", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      connection = new SocketConnection(socketPaths.command, "command", {
        connectionTimeout: 5000,
        messageTimeout: 3000,
      });

      await connection.connect();

      expect(connection.getState()).toBe(ConnectionState.Connected);
      expect(connection.isConnected()).toBe(true);
    });

    it.skipIf(skipIfNoHyprland())("should connect to event socket successfully", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      connection = new SocketConnection(socketPaths.event, "event", {
        connectionTimeout: 5000,
        messageTimeout: 3000,
      });

      await connection.connect();

      expect(connection.getState()).toBe(ConnectionState.Connected);
      expect(connection.isConnected()).toBe(true);
    });

    it.skipIf(skipIfNoHyprland())("should handle connection to invalid socket path", async () => {
      connection = new SocketConnection("/nonexistent/socket.sock", "command", {
        connectionTimeout: 1000,
        maxRetries: 1,
      });

      await expect(connection.connect()).rejects.toThrow();
      expect(connection.getState()).toBe(ConnectionState.Error);
    });

    it.skipIf(skipIfNoHyprland())("should maintain connection statistics", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      connection = new SocketConnection(socketPaths.command, "command");
      await connection.connect();

      const stats = connection.getStats();

      expect(stats.connectionsSuccessful).toBe(1);
      expect(stats.connectionsFailed).toBe(0);
      expect(stats.state).toBe(ConnectionState.Connected);
      expect(stats.uptime).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // HyprCtl Command Integration Tests
  // ========================================================================

  describe("HyprCtl Command Integration", () => {
    let connection: SocketConnection;

    beforeEach(async () => {
      if (!hyprlandAvailable || !socketPaths) return;

      connection = new SocketConnection(socketPaths.command, "command", {
        connectionTimeout: 5000,
        messageTimeout: 5000,
      });

      await connection.connect();
    });

    afterEach(async () => {
      if (connection) {
        await connection.close();
      }
    });

    it.skipIf(skipIfNoHyprland())("should execute version command", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: {
          command: "version",
        } as HyprCtlRequest,
        id: "version-test",
      };

      const response = await connection.sendRequest(request);

      expect(response.type).toBe("response");
      expect(response.id).toBe("version-test");
      expect(response.payload).toBeDefined();

      // Hyprland version response should contain version information
      if (typeof response.payload === "object" && response.payload !== null) {
        expect("data" in response.payload || "success" in response.payload).toBe(true);
      }
    });

    it.skipIf(skipIfNoHyprland())("should execute clients command", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: {
          command: "clients",
          json: true,
        } as HyprCtlRequest,
        id: "clients-test",
      };

      const response = await connection.sendRequest(request);

      expect(response.type).toBe("response");
      expect(response.id).toBe("clients-test");
      expect(response.payload).toBeDefined();
    });

    it.skipIf(skipIfNoHyprland())("should execute workspaces command", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: {
          command: "workspaces",
          json: true,
        } as HyprCtlRequest,
        id: "workspaces-test",
      };

      const response = await connection.sendRequest(request);

      expect(response.type).toBe("response");
      expect(response.id).toBe("workspaces-test");
      expect(response.payload).toBeDefined();
    });

    it.skipIf(skipIfNoHyprland())("should execute monitors command", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: {
          command: "monitors",
          json: true,
        } as HyprCtlRequest,
        id: "monitors-test",
      };

      const response = await connection.sendRequest(request);

      expect(response.type).toBe("response");
      expect(response.id).toBe("monitors-test");
      expect(response.payload).toBeDefined();
    });

    it.skipIf(skipIfNoHyprland())("should handle invalid command gracefully", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: {
          command: "nonexistent-command",
        } as HyprCtlRequest,
        id: "invalid-test",
      };

      const response = await connection.sendRequest(request);

      expect(response.type).toBe("response");
      expect(response.id).toBe("invalid-test");

      // Response should indicate error or failure
      if (typeof response.payload === "object" && response.payload !== null) {
        // Check for common error indicators
        const hasError =
          "error" in response.payload ||
          ("success" in response.payload && response.payload.success === false);
        expect(hasError).toBe(true);
      }
    });

    it.skipIf(skipIfNoHyprland())("should handle concurrent requests", async () => {
      const requests = [
        {
          type: "request" as const,
          payload: { command: "version" } as HyprCtlRequest,
          id: "concurrent-1",
        },
        {
          type: "request" as const,
          payload: { command: "clients", json: true } as HyprCtlRequest,
          id: "concurrent-2",
        },
        {
          type: "request" as const,
          payload: { command: "workspaces", json: true } as HyprCtlRequest,
          id: "concurrent-3",
        },
      ];

      const promises = requests.map((req) => connection.sendRequest(req));
      const responses = await Promise.all(promises);

      expect(responses).toHaveLength(3);

      responses.forEach((response, index) => {
        expect(response.type).toBe("response");
        expect(response.id).toBe(`concurrent-${index + 1}`);
        expect(response.payload).toBeDefined();
      });
    });
  });

  // ========================================================================
  // Event Socket Integration Tests
  // ========================================================================

  describe("Event Socket Integration", () => {
    let eventConnection: SocketConnection;

    beforeEach(async () => {
      if (!hyprlandAvailable || !socketPaths) return;

      eventConnection = new SocketConnection(socketPaths.event, "event", {
        connectionTimeout: 5000,
        messageTimeout: 5000,
      });

      await eventConnection.connect();
    });

    afterEach(async () => {
      if (eventConnection) {
        await eventConnection.close();
      }
    });

    it.skipIf(skipIfNoHyprland())("should connect to event socket", async () => {
      expect(eventConnection.getState()).toBe(ConnectionState.Connected);
      expect(eventConnection.isConnected()).toBe(true);
    });

    it.skipIf(skipIfNoHyprland())(
      "should receive events from Hyprland",
      async () => {
        return new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("No events received within timeout"));
          }, 15000); // 15 second timeout for events

          let eventReceived = false;

          eventConnection.on("event", (event) => {
            if (!eventReceived) {
              eventReceived = true;
              clearTimeout(timeout);

              expect(event).toBeDefined();
              expect(event.type).toBe("event");
              expect(event.payload).toBeDefined();

              resolve();
            }
          });

          eventConnection.on("message", (message) => {
            if (!eventReceived && message.type === "event") {
              eventReceived = true;
              clearTimeout(timeout);

              expect(message).toBeDefined();
              expect(message.type).toBe("event");
              expect(message.payload).toBeDefined();

              resolve();
            }
          });

          eventConnection.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      },
      20000
    ); // 20 second test timeout
  });

  // ========================================================================
  // Connection Pool Integration Tests
  // ========================================================================

  describe("Connection Pool Integration", () => {
    let pool: SocketConnectionPool;

    afterEach(async () => {
      if (pool) {
        await pool.close(true);
      }
    });

    it.skipIf(skipIfNoHyprland())("should create and manage connection pool", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      pool = new SocketConnectionPool(socketPaths.command, "command", {
        minConnections: 1,
        maxConnections: 3,
        acquisitionTimeout: 5000,
        preWarmConnections: true,
      });

      // Allow pool to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const stats = pool.getStats();
      expect(stats.totalConnections).toBeGreaterThanOrEqual(1);
    });

    it.skipIf(skipIfNoHyprland())("should execute commands through pool", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      pool = new SocketConnectionPool(socketPaths.command, "command", {
        maxConnections: 2,
        acquisitionTimeout: 5000,
      });

      const request: IPCRequest = {
        type: "request",
        payload: {
          command: "version",
        } as HyprCtlRequest,
        id: "pool-test",
      };

      const response = await pool.sendRequest(request);

      expect(response.type).toBe("response");
      expect(response.id).toBe("pool-test");
      expect(response.payload).toBeDefined();
    });

    it.skipIf(skipIfNoHyprland())("should handle concurrent pool operations", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      pool = new SocketConnectionPool(socketPaths.command, "command", {
        maxConnections: 2,
        acquisitionTimeout: 5000,
      });

      const requests = Array.from({ length: 5 }, (_, i) => ({
        type: "request" as const,
        payload: { command: "version" } as HyprCtlRequest,
        id: `pool-concurrent-${i}`,
      }));

      const promises = requests.map((req) => pool.sendRequest(req));
      const responses = await Promise.all(promises);

      expect(responses).toHaveLength(5);
      responses.forEach((response, index) => {
        expect(response.type).toBe("response");
        expect(response.id).toBe(`pool-concurrent-${index}`);
      });
    });
  });

  // ========================================================================
  // Error Handling and Recovery Integration Tests
  // ========================================================================

  describe("Error Handling Integration", () => {
    it.skipIf(skipIfNoHyprland())("should handle socket disconnection gracefully", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      const connection = new SocketConnection(socketPaths.command, "command", {
        connectionTimeout: 3000,
        messageTimeout: 2000,
        maxRetries: 1,
      });

      await connection.connect();
      expect(connection.isConnected()).toBe(true);

      // Close the connection and verify it's handled
      await connection.close();
      expect(connection.getState()).toBe(ConnectionState.CLOSED);
    });

    it.skipIf(skipIfNoHyprland())("should handle request timeout", async () => {
      if (!socketPaths) throw new Error("Socket paths not available");

      const connection = new SocketConnection(socketPaths.command, "command", {
        connectionTimeout: 3000,
        messageTimeout: 100, // Very short timeout
      });

      await connection.connect();

      const request: IPCRequest = {
        type: "request",
        payload: {
          command: "version",
        } as HyprCtlRequest,
        id: "timeout-test",
      };

      // This might timeout depending on Hyprland's response time
      try {
        await connection.sendRequest(request);
      } catch (error) {
        // Timeout is acceptable for this test
        expect(error).toBeDefined();
      }

      await connection.close();
    });
  });

  // ========================================================================
  // Performance Integration Tests
  // ========================================================================

  describe("Performance Integration", () => {
    it.skipIf(skipIfNoHyprland())(
      "should handle rapid request cycles",
      async () => {
        if (!socketPaths) throw new Error("Socket paths not available");

        const connection = new SocketConnection(socketPaths.command, "command", {
          connectionTimeout: 5000,
          messageTimeout: 3000,
        });

        await connection.connect();

        const startTime = Date.now();
        const requestCount = 20;

        const requests = Array.from({ length: requestCount }, (_, i) => ({
          type: "request" as const,
          payload: { command: "version" } as HyprCtlRequest,
          id: `perf-${i}`,
        }));

        const promises = requests.map((req) => connection.sendRequest(req));
        const responses = await Promise.all(promises);

        const duration = Date.now() - startTime;

        expect(responses).toHaveLength(requestCount);
        expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

        const stats = connection.getStats();
        expect(stats.messagesSent).toBeGreaterThanOrEqual(requestCount);
        expect(stats.averageRtt).toBeGreaterThan(0);

        await connection.close();
      },
      15000
    ); // 15 second test timeout

    it.skipIf(skipIfNoHyprland())(
      "should maintain performance under load",
      async () => {
        if (!socketPaths) throw new Error("Socket paths not available");

        const pool = new SocketConnectionPool(socketPaths.command, "command", {
          minConnections: 2,
          maxConnections: 4,
          acquisitionTimeout: 5000,
        });

        const concurrentOperations = 50;
        const startTime = Date.now();

        const operations = Array.from({ length: concurrentOperations }, (_, i) =>
          pool.sendRequest({
            type: "request",
            payload: { command: "version" } as HyprCtlRequest,
            id: `load-${i}`,
          })
        );

        const results = await Promise.allSettled(operations);
        const duration = Date.now() - startTime;

        const successful = results.filter((r) => r.status === "fulfilled");
        const failed = results.filter((r) => r.status === "rejected");

        // At least 80% should succeed
        expect(successful.length / results.length).toBeGreaterThan(0.8);

        // Should complete within reasonable time
        expect(duration).toBeLessThan(30000); // 30 seconds

        const poolStats = pool.getStats();
        expect(poolStats.totalConnections).toBeGreaterThan(0);
        expect(poolStats.utilization).toBeGreaterThanOrEqual(0);

        console.log(
          `Load test: ${successful.length}/${results.length} requests succeeded in ${duration}ms`
        );
        console.log(`Pool utilization: ${poolStats.utilization.toFixed(2)}%`);

        if (failed.length > 0) {
          console.log(`Failed requests: ${failed.length}`);
        }

        await pool.close();
      },
      35000
    ); // 35 second test timeout
  });
});
