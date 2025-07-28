/**
 * @file Unit tests for HyprlandClient class
 *
 * These tests cover all core functionality of the HyprlandClient including
 * initialization, connection management, state transitions, health monitoring,
 * command execution, event handling, metrics collection, and error scenarios.
 */

import { EventEmitter } from "node:events";
import { type MockedFunction, beforeEach, describe, expect, it, vi } from "vitest";
import { type EventMetadata, type EventSystemStats, HyprlandEventSystem } from "./event-system.js";
import {
  type CommandOptions,
  type CommandResult,
  HyprCtlClient,
  type HyprCtlCommand,
  type PerformanceMetrics,
} from "./hyprctl-client.js";
import {
  CapabilityError,
  type ClientHealth,
  type ClientMetrics,
  ClientState,
  ConfigurationError,
  ConnectionError,
  HyprlandClient,
  type HyprlandClientConfig,
} from "./hyprland-client.js";
import { discoverSockets } from "./socket-discovery.js";

// ============================================================================
// Test Mocks and Setup
// ============================================================================

// Type definitions for mocks
interface MockHyprctlClient {
  executeCommand: MockedFunction<
    <T = unknown>(
      command: HyprCtlCommand | "dispatch",
      args?: readonly string[],
      options?: CommandOptions
    ) => Promise<CommandResult<T>>
  >;
  getMetrics: MockedFunction<() => PerformanceMetrics>;
  close: MockedFunction<() => Promise<void>>;
}

interface MockEventSystem {
  connect: MockedFunction<() => Promise<void>>;
  disconnect: MockedFunction<() => Promise<void>>;
  subscribe: MockedFunction<
    <T = unknown>(
      eventTypes: string | readonly string[],
      handler: (event: T, metadata: EventMetadata) => void | Promise<void>,
      options?: { filter?: (event: T) => boolean; transform?: (event: T) => T }
    ) => Promise<{ unsubscribe: () => void }>
  >;
  getStats: MockedFunction<() => EventSystemStats>;
  on: MockedFunction<(event: string, listener: (...args: unknown[]) => void) => void>;
  off: MockedFunction<(event: string, listener: (...args: unknown[]) => void) => void>;
}

// Mock the external dependencies
vi.mock("./hyprctl-client.js");
vi.mock("./event-system.js");
vi.mock("./socket-discovery.js");

const MockHyprCtlClient = HyprCtlClient as vi.MockedClass<typeof HyprCtlClient>;
const MockHyprlandEventSystem = HyprlandEventSystem as vi.MockedClass<typeof HyprlandEventSystem>;
const mockDiscoverSockets = discoverSockets as MockedFunction<typeof discoverSockets>;

// Create mock socket discovery result
const mockSocketResult = {
  success: true,
  instances: [
    {
      signature: "test123",
      runtimeDir: "/tmp/hypr/test123",
      commandSocket: {
        path: "/tmp/hypr/test123/.socket.sock",
        type: "command" as const,
        instance: "test123",
        exists: true,
        permissions: { readable: true, writable: true },
      },
      eventSocket: {
        path: "/tmp/hypr/test123/.socket2.sock",
        type: "event" as const,
        instance: "test123",
        exists: true,
        permissions: { readable: true, writable: true },
      },
    },
  ],
  activeInstance: {
    signature: "test123",
    runtimeDir: "/tmp/hypr/test123",
    commandSocket: {
      path: "/tmp/hypr/test123/.socket.sock",
      type: "command" as const,
      instance: "test123",
      exists: true,
      permissions: { readable: true, writable: true },
    },
    eventSocket: {
      path: "/tmp/hypr/test123/.socket2.sock",
      type: "event" as const,
      instance: "test123",
      exists: true,
      permissions: { readable: true, writable: true },
    },
  },
};

describe("HyprlandClient", () => {
  let client: HyprlandClient;
  let mockHyprctlClient: MockHyprctlClient;
  let mockEventSystem: MockEventSystem;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup HyprCtlClient mock
    mockHyprctlClient = {
      executeCommand: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        totalCommands: 10,
        successfulCommands: 8,
        failedCommands: 2,
        averageExecutionTime: 50,
        commandsPerSecond: 2.5,
      }),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    MockHyprCtlClient.mockImplementation(() => mockHyprctlClient);

    // Setup HyprlandEventSystem mock
    mockEventSystem = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      getStats: vi.fn().mockReturnValue({
        connectionState: "connected",
        eventsReceived: 100,
        eventsProcessed: 95,
        activeSubscriptions: 3,
        averageProcessingTime: 5,
        eventsPerSecond: 10,
        eventsBuffered: 5,
      }),
      on: vi.fn(),
    };
    MockHyprlandEventSystem.mockImplementation(() => mockEventSystem);

    // Setup socket discovery mock
    mockDiscoverSockets.mockResolvedValue(mockSocketResult);
  });

  // ============================================================================
  // Constructor and Configuration Tests
  // ============================================================================

  describe("constructor", () => {
    it("should create client with default configuration", () => {
      client = new HyprlandClient();
      expect(client).toBeInstanceOf(HyprlandClient);
      expect(client.state).toBe(ClientState.Disconnected);
      expect(client.isConnected).toBe(false);
    });

    it("should create client with custom configuration", () => {
      const config: HyprlandClientConfig = {
        connection: {
          timeout: 10000,
          autoReconnect: false,
          maxRetries: 5,
        },
        monitoring: {
          enabled: false,
        },
      };

      client = new HyprlandClient(config);
      expect(client).toBeInstanceOf(HyprlandClient);
      expect(client.state).toBe(ClientState.Disconnected);
    });

    it("should validate configuration and throw on invalid values", () => {
      expect(() => {
        new HyprlandClient({
          connection: { timeout: -1 },
        });
      }).toThrow(ConfigurationError);

      expect(() => {
        new HyprlandClient({
          // @ts-expect-error: Intentionally passing invalid type for testing validation
          sockets: { command: 123 },
        });
      }).toThrow(ConfigurationError);
    });
  });

  // ============================================================================
  // Connection Management Tests
  // ============================================================================

  describe("connection management", () => {
    beforeEach(() => {
      client = new HyprlandClient();
    });

    it("should connect successfully with socket discovery", async () => {
      const connectPromise = client.connect();

      expect(client.state).toBe(ClientState.Connecting);

      await connectPromise;

      expect(client.state).toBe(ClientState.Connected);
      expect(client.isConnected).toBe(true);
      expect(mockDiscoverSockets).toHaveBeenCalled();
      expect(MockHyprCtlClient).toHaveBeenCalledWith({
        socketPath: "/tmp/hypr/test123/.socket.sock",
      });
      expect(MockHyprlandEventSystem).toHaveBeenCalledWith(
        mockSocketResult.activeInstance?.eventSocket,
        {}
      );
    });

    it("should connect with explicit socket paths", async () => {
      client = new HyprlandClient({
        sockets: {
          command: "/custom/command.sock",
          event: "/custom/event.sock",
        },
      });

      await client.connect();

      expect(client.state).toBe(ClientState.Connected);
      expect(mockDiscoverSockets).not.toHaveBeenCalled();
      expect(MockHyprCtlClient).toHaveBeenCalledWith({
        socketPath: "/custom/command.sock",
      });
    });

    it("should handle connection failure gracefully", async () => {
      mockDiscoverSockets.mockResolvedValue({
        success: false,
        instances: [],
        error: "No instances found",
      });

      await expect(client.connect()).rejects.toThrow(ConnectionError);
      expect(client.state).toBe(ClientState.Error);
    });

    it("should not connect if already connected", async () => {
      await client.connect();
      const initialState = client.state;

      // Attempt to connect again
      await client.connect();

      expect(client.state).toBe(initialState);
      expect(mockDiscoverSockets).toHaveBeenCalledTimes(1);
    });

    it("should prevent connection during shutdown", async () => {
      client = new HyprlandClient();

      // Start disconnect process
      const disconnectPromise = client.disconnect();

      // Try to connect during shutdown
      await expect(client.connect()).rejects.toThrow(ConnectionError);

      await disconnectPromise;
    });
  });

  // ============================================================================
  // State Management Tests
  // ============================================================================

  describe("state management", () => {
    beforeEach(() => {
      client = new HyprlandClient();
    });

    it("should emit state change events", async () => {
      const stateChangeHandler = vi.fn();
      client.on("stateChanged", stateChangeHandler);

      await client.connect();

      expect(stateChangeHandler).toHaveBeenCalledWith({
        from: ClientState.Disconnected,
        to: ClientState.Connecting,
      });
      expect(stateChangeHandler).toHaveBeenCalledWith({
        from: ClientState.Connecting,
        to: ClientState.Connected,
      });
    });

    it("should transition through all expected states during connection", async () => {
      const states: ClientState[] = [];
      client.on("stateChanged", ({ to }) => states.push(to));

      await client.connect();

      expect(states).toEqual([ClientState.Connecting, ClientState.Connected]);
    });

    it("should handle error state correctly", async () => {
      mockEventSystem.connect.mockRejectedValue(new Error("Connection failed"));

      try {
        await client.connect();
      } catch {
        // Expected
      }

      expect(client.state).toBe(ClientState.Error);
    });
  });

  // ============================================================================
  // Command Execution Tests
  // ============================================================================

  describe("command execution", () => {
    beforeEach(async () => {
      client = new HyprlandClient();
      await client.connect();
    });

    it("should execute commands successfully", async () => {
      const mockResult = {
        success: true,
        data: { test: "data" },
        error: undefined,
        executionTime: 25,
        timestamp: Date.now(),
        command: "clients",
        args: [],
      };
      mockHyprctlClient.executeCommand.mockResolvedValue(mockResult);

      const result = await client.executeCommand("clients");

      expect(result).toEqual({ test: "data" });
      expect(mockHyprctlClient.executeCommand).toHaveBeenCalledWith(
        "clients",
        undefined,
        undefined
      );
    });

    it("should handle command execution failures", async () => {
      const mockResult = {
        success: false,
        data: undefined,
        error: "Command failed",
        executionTime: 10,
        timestamp: Date.now(),
        command: "invalid",
        args: [],
      };
      mockHyprctlClient.executeCommand.mockResolvedValue(mockResult);

      await expect(client.executeCommand("invalid")).rejects.toThrow("Command failed");
    });

    it("should reject commands when not connected", async () => {
      client = new HyprlandClient();

      await expect(client.executeCommand("clients")).rejects.toThrow(ConnectionError);
    });

    it("should pass through command options", async () => {
      const mockResult = {
        success: true,
        data: "test",
        error: undefined,
        executionTime: 25,
        timestamp: Date.now(),
        command: "test",
        args: ["arg1"],
      };
      mockHyprctlClient.executeCommand.mockResolvedValue(mockResult);

      const options = { timeout: 5000, priority: "high" as const };
      await client.executeCommand("test", ["arg1"], options);

      expect(mockHyprctlClient.executeCommand).toHaveBeenCalledWith("test", ["arg1"], options);
    });
  });

  // ============================================================================
  // Event Subscription Tests
  // ============================================================================

  describe("event subscription", () => {
    beforeEach(async () => {
      client = new HyprlandClient();
      await client.connect();
    });

    it("should subscribe to events successfully", async () => {
      const mockSubscription = {
        id: "sub-123",
        eventTypes: ["workspace"],
        options: {},
        unsubscribe: vi.fn(),
        getStats: vi.fn(),
      };
      mockEventSystem.subscribe.mockResolvedValue(mockSubscription);

      const handler = vi.fn();
      const subscription = await client.subscribe("workspace", handler);

      expect(mockEventSystem.subscribe).toHaveBeenCalledWith("workspace", handler, undefined);
      expect(subscription).toHaveProperty("unsubscribe");
      expect(typeof subscription.unsubscribe).toBe("function");
    });

    it("should handle subscription failures", async () => {
      mockEventSystem.subscribe.mockRejectedValue(new Error("Subscription failed"));

      const handler = vi.fn();
      await expect(client.subscribe("workspace", handler)).rejects.toThrow("Subscription failed");
    });

    it("should reject subscriptions when not connected", async () => {
      client = new HyprlandClient();

      const handler = vi.fn();
      await expect(client.subscribe("workspace", handler)).rejects.toThrow(ConnectionError);
    });

    it("should pass through subscription options", async () => {
      const mockSubscription = {
        id: "sub-123",
        eventTypes: ["workspace"],
        options: {},
        unsubscribe: vi.fn(),
        getStats: vi.fn(),
      };
      mockEventSystem.subscribe.mockResolvedValue(mockSubscription);

      const handler = vi.fn();
      const options = {
        filter: (event: unknown) => (event as { id: number }).id > 0,
        transform: (event: unknown) => ({ ...event, transformed: true }),
      };

      await client.subscribe("workspace", handler, options);

      expect(mockEventSystem.subscribe).toHaveBeenCalledWith("workspace", handler, options);
    });
  });

  // ============================================================================
  // Health Monitoring Tests
  // ============================================================================

  describe("health monitoring", () => {
    beforeEach(async () => {
      client = new HyprlandClient();
      await client.connect();
    });

    it("should return healthy status when all systems operational", () => {
      const health = client.getHealth();

      expect(health.status).toBe("healthy");
      expect(health.commandHealth).toBe("healthy");
      expect(health.eventHealth).toBe("healthy");
      expect(health.issues).toHaveLength(0);
      expect(health.uptime).toBeGreaterThan(0);
    });

    it("should detect unhealthy command system", () => {
      // Simulate missing command client
      // @ts-expect-error: Accessing private property for testing
      client.hyprctlClient = null;

      const health = client.getHealth();

      expect(health.status).toBe("unhealthy");
      expect(health.commandHealth).toBe("unhealthy");
      expect(health.issues).toContain("Command client not initialized");
    });

    it("should detect degraded event system", () => {
      mockEventSystem.getStats.mockReturnValue({
        ...mockEventSystem.getStats(),
        connectionState: "disconnected",
      });

      const health = client.getHealth();

      expect(health.status).toBe("degraded");
      expect(health.eventHealth).toBe("degraded");
      expect(health.issues).toContain("Event connection state: disconnected");
    });

    it("should emit health check events when monitoring enabled", (done) => {
      client = new HyprlandClient({
        connection: { healthCheckInterval: 100 },
      });

      client.on("healthCheck", (health: ClientHealth) => {
        expect(health).toHaveProperty("status");
        expect(health).toHaveProperty("uptime");
        done();
      });

      client.connect();
    });
  });

  // ============================================================================
  // Metrics Collection Tests
  // ============================================================================

  describe("metrics collection", () => {
    beforeEach(async () => {
      client = new HyprlandClient();
      await client.connect();
    });

    it("should collect comprehensive metrics", () => {
      const metrics = client.getMetrics();

      expect(metrics).toHaveProperty("uptime");
      expect(metrics).toHaveProperty("connection");
      expect(metrics).toHaveProperty("commands");
      expect(metrics).toHaveProperty("events");
      expect(metrics).toHaveProperty("resources");

      expect(metrics.connection.totalConnections).toBe(1);
      expect(metrics.commands.totalExecuted).toBe(10);
      expect(metrics.events.totalReceived).toBe(100);
    });

    it("should track connection attempts and failures", async () => {
      client = new HyprlandClient();

      // Simulate failed connection
      mockDiscoverSockets.mockResolvedValueOnce({
        success: false,
        instances: [],
        error: "No instances",
      });

      try {
        await client.connect();
      } catch {
        // Expected
      }

      // Reset mock for successful connection
      mockDiscoverSockets.mockResolvedValue(mockSocketResult);
      await client.connect();

      const metrics = client.getMetrics();
      expect(metrics.connection.totalConnections).toBe(2);
      expect(metrics.connection.failedConnections).toBe(1);
    });

    it("should emit metrics events when monitoring enabled", (done) => {
      client = new HyprlandClient({
        lifecycle: { cleanupInterval: 100 },
        monitoring: { enabled: true },
      });

      client.on("metrics", (metrics: ClientMetrics) => {
        expect(metrics).toHaveProperty("uptime");
        expect(metrics).toHaveProperty("connection");
        done();
      });

      client.connect();
    });
  });

  // ============================================================================
  // Capability Detection Tests
  // ============================================================================

  describe("capability detection", () => {
    beforeEach(() => {
      client = new HyprlandClient();
    });

    it("should detect capabilities on connection", async () => {
      mockHyprctlClient.executeCommand.mockResolvedValue({
        success: true,
        data: "Hyprland v0.30.0",
        error: undefined,
        executionTime: 10,
        timestamp: Date.now(),
        command: "version",
        args: [],
      });

      await client.connect();

      const capabilities = client.clientCapabilities;
      expect(capabilities).not.toBeNull();
      expect(capabilities?.version).toBe("Hyprland v0.30.0");
      expect(capabilities?.supportedCommands).toContain("clients");
      expect(capabilities?.supportedEvents).toContain("workspace");
    });

    it("should use cached capabilities when provided", async () => {
      const cachedCapabilities = {
        version: "cached-version",
        supportedCommands: ["test"],
        supportedEvents: ["test"],
        features: {
          batchCommands: true,
          eventFiltering: true,
          asyncEvents: true,
        },
      };

      client = new HyprlandClient({
        capabilities: { cached: cachedCapabilities },
      });

      await client.connect();

      expect(client.clientCapabilities).toEqual(cachedCapabilities);
      expect(mockHyprctlClient.executeCommand).not.toHaveBeenCalledWith("version");
    });

    it("should handle capability detection failure gracefully", async () => {
      mockHyprctlClient.executeCommand.mockRejectedValue(new Error("Version command failed"));

      await client.connect();

      const capabilities = client.clientCapabilities;
      expect(capabilities).not.toBeNull();
      expect(capabilities?.version).toBe("unknown");
      expect(capabilities?.supportedCommands).toHaveLength(0);
    });

    it("should emit capability detection events", async () => {
      const capabilitiesHandler = vi.fn();
      const errorHandler = vi.fn();

      client.on("capabilitiesDetected", capabilitiesHandler);
      client.on("capabilityDetectionError", errorHandler);

      mockHyprctlClient.executeCommand.mockResolvedValue({
        success: true,
        data: "Hyprland v0.30.0",
        error: undefined,
        executionTime: 10,
        timestamp: Date.now(),
        command: "version",
        args: [],
      });

      await client.connect();

      expect(capabilitiesHandler).toHaveBeenCalled();
      expect(errorHandler).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Resource Management and Cleanup Tests
  // ============================================================================

  describe("resource management", () => {
    beforeEach(async () => {
      client = new HyprlandClient();
      await client.connect();
    });

    it("should perform graceful shutdown", async () => {
      const disconnectPromise = client.disconnect();

      expect(client.state).toBe(ClientState.ShuttingDown);

      await disconnectPromise;

      expect(client.state).toBe(ClientState.Disconnected);
      expect(mockEventSystem.disconnect).toHaveBeenCalled();
      expect(mockHyprctlClient.close).toHaveBeenCalled();
    });

    it("should emit disconnect events", async () => {
      const disconnectedHandler = vi.fn();
      client.on("disconnected", disconnectedHandler);

      await client.disconnect();

      expect(disconnectedHandler).toHaveBeenCalled();
    });

    it("should handle shutdown timeout", async () => {
      client = new HyprlandClient({
        lifecycle: { shutdownTimeout: 100 },
      });
      await client.connect();

      // Make shutdown operations hang
      mockEventSystem.disconnect.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      await expect(client.disconnect()).rejects.toThrow("Shutdown timeout");
    });

    it("should prevent multiple simultaneous shutdowns", async () => {
      const shutdown1 = client.disconnect();
      const shutdown2 = client.disconnect();

      const [result1, result2] = await Promise.allSettled([shutdown1, shutdown2]);

      expect(result1.status).toBe("fulfilled");
      expect(result2.status).toBe("fulfilled");
      expect(mockEventSystem.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("error handling", () => {
    beforeEach(() => {
      client = new HyprlandClient();
    });

    it("should propagate command errors", async () => {
      await client.connect();

      const commandErrorHandler = vi.fn();
      client.on("commandError", commandErrorHandler);

      const error = new Error("Command failed");
      mockHyprctlClient.executeCommand.mockRejectedValue(error);

      await expect(client.executeCommand("test")).rejects.toThrow("Command failed");
      expect(commandErrorHandler).toHaveBeenCalledWith(error);
    });

    it("should propagate event system errors", async () => {
      await client.connect();

      const eventErrorHandler = vi.fn();
      client.on("eventError", eventErrorHandler);

      const error = new Error("Event error");

      // Simulate event system error emission
      const eventSystemInstance = MockHyprlandEventSystem.mock.instances[0];
      const onCall = eventSystemInstance.on.mock.calls.find((call) => call[0] === "error");
      expect(onCall).toBeDefined();

      // Trigger the error handler
      onCall[1](error);

      expect(eventErrorHandler).toHaveBeenCalledWith(error);
    });

    it("should handle subscription errors gracefully", async () => {
      await client.connect();

      const subscriptionErrorHandler = vi.fn();
      client.on("subscriptionError", subscriptionErrorHandler);

      const error = new Error("Subscription failed");
      mockEventSystem.subscribe.mockRejectedValue(error);

      const handler = vi.fn();
      await expect(client.subscribe("workspace", handler)).rejects.toThrow("Subscription failed");
      expect(subscriptionErrorHandler).toHaveBeenCalledWith(error);
    });

    it("should emit shutdown errors", async () => {
      await client.connect();

      const shutdownErrorHandler = vi.fn();
      client.on("shutdownError", shutdownErrorHandler);

      const error = new Error("Shutdown failed");
      mockEventSystem.disconnect.mockRejectedValue(error);

      await expect(client.disconnect()).rejects.toThrow("Shutdown failed");
      expect(shutdownErrorHandler).toHaveBeenCalledWith(error);
    });
  });

  // ============================================================================
  // Reconnection Tests
  // ============================================================================

  describe("reconnection handling", () => {
    beforeEach(async () => {
      client = new HyprlandClient({
        connection: {
          autoReconnect: true,
          maxRetries: 2,
          retryDelay: 50,
        },
      });
      await client.connect();
    });

    it("should attempt reconnection on event system disconnection", (done) => {
      const reconnectedHandler = vi.fn();
      client.on("reconnected", reconnectedHandler);
      client.on("stateChanged", ({ to }) => {
        if (to === ClientState.Reconnecting) {
          // Simulate successful reconnection
          setTimeout(() => {
            expect(reconnectedHandler).toHaveBeenCalled();
            done();
          }, 100);
        }
      });

      // Simulate event system disconnection
      const eventSystemInstance = MockHyprlandEventSystem.mock.instances[0];
      const onCall = eventSystemInstance.on.mock.calls.find((call) => call[0] === "disconnected");
      expect(onCall).toBeDefined();

      // Trigger disconnection
      onCall[1]();
    });

    it("should emit reconnection attempt events", (done) => {
      let attemptCount = 0;
      client.on("reconnectionAttempt", ({ attempt }) => {
        attemptCount++;
        expect(attempt).toBe(attemptCount);
        if (attemptCount === 2) {
          done();
        }
      });

      // Make reconnection fail initially
      mockEventSystem.connect
        .mockRejectedValueOnce(new Error("Reconnect failed"))
        .mockRejectedValueOnce(new Error("Reconnect failed"));

      // Trigger reconnection
      // @ts-expect-error: Accessing private method for testing
      client.handleReconnection();
    });

    it("should transition to error state after max retries", (done) => {
      client.on("reconnectionFailed", (error) => {
        expect(error).toBeInstanceOf(ConnectionError);
        expect(client.state).toBe(ClientState.Error);
        done();
      });

      // Make all reconnection attempts fail
      mockEventSystem.connect.mockRejectedValue(new Error("Connection failed"));

      // Trigger reconnection
      // @ts-expect-error: Accessing private method for testing
      client.handleReconnection();
    });
  });

  // ============================================================================
  // Client Status Tests
  // ============================================================================

  describe("client status", () => {
    beforeEach(async () => {
      client = new HyprlandClient();
      await client.connect();
    });

    it("should provide comprehensive status information", () => {
      const status = client.getClientStatus();

      expect(status).toHaveProperty("state");
      expect(status).toHaveProperty("health");
      expect(status).toHaveProperty("capabilities");
      expect(status).toHaveProperty("uptime");

      expect(status.state).toBe(ClientState.Connected);
      expect(status.health.status).toBe("healthy");
      expect(status.uptime).toBeGreaterThan(0);
    });

    it("should reflect current client state in status", async () => {
      let status = client.getClientStatus();
      expect(status.state).toBe(ClientState.Connected);

      await client.disconnect();

      status = client.getClientStatus();
      expect(status.state).toBe(ClientState.Disconnected);
    });
  });
});
