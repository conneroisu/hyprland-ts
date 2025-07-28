/**
 * Comprehensive unit tests for HyprCtl command execution system.
 *
 * Tests cover all aspects of the command execution system including:
 * - Command execution and validation
 * - Request formatting and response parsing
 * - Batch command execution
 * - Result caching with TTL
 * - Command history tracking
 * - Performance monitoring
 * - Error handling and timeout management
 * - Rate limiting functionality
 * - Event emission
 */

import { EventEmitter } from "node:events";
import { type MockedFunction, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BatchCommandOptions,
  CommandExecutionError,
  type CommandOptions,
  CommandTimeoutError,
  CommandValidationError,
  HyprCtlClient,
  type HyprCtlClientConfig,
  HyprCtlError,
} from "./hyprctl-client.js";
import type {
  HyprCtlCommand,
  HyprCtlDispatchCommand,
  HyprCtlRequest,
  HyprCtlResponse,
  IPCRequest,
  IPCResponse,
} from "./types.js";

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the socket pool module
vi.mock("./socket-pool.js", () => {
  const MockSocketConnectionPool = vi.fn().mockImplementation(() => {
    return {
      withConnection: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      emit: vi.fn(),
    };
  });

  return {
    /* biome-ignore lint/style/useNamingConvention: Mock export must match actual export */
    SocketConnectionPool: MockSocketConnectionPool,
  };
});

vi.mock("./concurrency.js", () => {
  const MockRateLimiter = vi.fn().mockImplementation(() => {
    return {
      acquire: vi.fn().mockResolvedValue(undefined),
      availableTokens: vi.fn().mockReturnValue(10),
      getCapacity: vi.fn().mockReturnValue(50),
      getRefillRate: vi.fn().mockReturnValue(50),
    };
  });

  const MockMutex = vi.fn().mockImplementation(() => {
    return {
      acquire: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      withLock: vi.fn().mockImplementation(async (fn) => fn()),
    };
  });

  const MockAtomicBoolean = vi.fn().mockImplementation(() => {
    return {
      get: vi.fn().mockReturnValue(false),
      set: vi.fn(),
      toggle: vi.fn().mockReturnValue(true),
    };
  });

  const MockAtomicCounter = vi.fn().mockImplementation(() => {
    return {
      get: vi.fn().mockReturnValue(0),
      increment: vi.fn().mockReturnValue(1),
      decrement: vi.fn().mockReturnValue(-1),
    };
  });

  const MockReadWriteLock = vi.fn().mockImplementation(() => {
    return {
      acquireRead: vi.fn().mockResolvedValue(undefined),
      acquireWrite: vi.fn().mockResolvedValue(undefined),
      releaseRead: vi.fn(),
      releaseWrite: vi.fn(),
    };
  });

  const MockSemaphore = vi.fn().mockImplementation(() => {
    return {
      acquire: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
  });

  return {
    /* biome-ignore lint/style/useNamingConvention: Mock exports must match actual exports */
    RateLimiter: MockRateLimiter,
    /* biome-ignore lint/style/useNamingConvention: Mock exports must match actual exports */
    Mutex: MockMutex,
    /* biome-ignore lint/style/useNamingConvention: Mock exports must match actual exports */
    AtomicBoolean: MockAtomicBoolean,
    /* biome-ignore lint/style/useNamingConvention: Mock exports must match actual exports */
    AtomicCounter: MockAtomicCounter,
    /* biome-ignore lint/style/useNamingConvention: Mock exports must match actual exports */
    ReadWriteLock: MockReadWriteLock,
    /* biome-ignore lint/style/useNamingConvention: Mock exports must match actual exports */
    Semaphore: MockSemaphore,
    withConcurrency: vi.fn().mockImplementation(async (fn) => fn()),
    debounce: vi.fn().mockImplementation((fn) => fn),
    throttle: vi.fn().mockImplementation((fn) => fn),
  };
});

import { RateLimiter } from "./concurrency.js";
// Import after mocking
import { SocketConnectionPool } from "./socket-pool.js";

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_CONFIG: HyprCtlClientConfig = {
  socketPath: "/tmp/test-hypr-socket.sock",
  commandTimeout: 1000,
  enableCaching: true,
  cacheTtl: 500,
  maxCacheSize: 10,
  enableHistory: true,
  maxHistorySize: 100,
  maxCommandsPerSecond: 50,
  enableMonitoring: true,
};

const MOCK_WINDOW_DATA = [
  {
    address: "0x1234567890abcdef",
    mapped: true,
    hidden: false,
    at: [100, 200] as const,
    size: [800, 600] as const,
    workspace: { id: 1, name: "workspace1" },
    floating: false,
    monitor: 0,
    class: "firefox",
    title: "Mozilla Firefox",
  },
];

// ============================================================================
// Test Suite
// ============================================================================

describe("HyprCtlClient", () => {
  let client: HyprCtlClient;
  let mockConnectionPool: unknown;
  let mockRateLimiter: unknown;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create client
    client = new HyprCtlClient(TEST_CONFIG);

    // Get mock instances - they are created during client construction
    const poolConstructor = vi.mocked(SocketConnectionPool);
    const limiterConstructor = vi.mocked(RateLimiter);

    // Get the most recent instances created
    mockConnectionPool =
      poolConstructor.mock.results[poolConstructor.mock.results.length - 1]?.value;
    mockRateLimiter =
      limiterConstructor.mock.results[limiterConstructor.mock.results.length - 1]?.value;
  });

  afterEach(async () => {
    await client.close();
  });

  // ========================================================================
  // Construction and Configuration Tests
  // ========================================================================

  describe("Construction", () => {
    it("should create client with default configuration", () => {
      const minimalClient = new HyprCtlClient({ socketPath: "/tmp/test.sock" });
      expect(minimalClient).toBeInstanceOf(HyprCtlClient);
    });

    it("should create client with custom configuration", () => {
      expect(client).toBeInstanceOf(HyprCtlClient);
      expect(client).toBeInstanceOf(EventEmitter);
    });

    it("should initialize connection pool with correct parameters", () => {
      expect(SocketConnectionPool).toHaveBeenCalledWith(
        TEST_CONFIG.socketPath,
        "command",
        expect.objectContaining({
          minConnections: 1,
          maxConnections: 5,
          maxIdleTime: 30000,
          acquisitionTimeout: TEST_CONFIG.commandTimeout,
        })
      );
    });

    it("should initialize rate limiter with correct parameters", () => {
      expect(RateLimiter).toHaveBeenCalledWith(
        TEST_CONFIG.maxCommandsPerSecond,
        TEST_CONFIG.maxCommandsPerSecond
      );
    });
  });

  // ========================================================================
  // Command Execution Tests
  // ========================================================================

  describe("Command Execution", () => {
    beforeEach(() => {
      // Mock successful connection execution
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockImplementation(async () => {
              // Add small delay to simulate execution time
              await new Promise((resolve) => setTimeout(resolve, 1));
              return {
                type: "response",
                payload: {
                  success: true,
                  data: MOCK_WINDOW_DATA,
                  error: undefined,
                },
                id: "test-response-id",
              } as IPCResponse;
            }),
          };
          return fn(mockConnection);
        }
      );
    });

    it("should execute simple command successfully", async () => {
      const result = await client.executeCommand("clients");

      expect(result.success).toBe(true);
      expect(result.data).toEqual(MOCK_WINDOW_DATA);
      expect(result.command).toBe("clients");
      expect(result.executionTime).toBeGreaterThan(0);
      expect(result.timestamp).toBeGreaterThan(0);
      expect(result.fromCache).toBe(false);
    });

    it("should execute command with arguments", async () => {
      const result = await client.executeCommand("getoption", ["general:border_size"]);

      expect(result.success).toBe(true);
      expect(result.args).toEqual(["general:border_size"]);
      expect(mockConnectionPool.withConnection).toHaveBeenCalledTimes(1);
    });

    it("should execute dispatch command", async () => {
      const result = await client.executeDispatch("workspace", ["2"]);

      expect(result.success).toBe(true);
      expect(result.command).toBe("dispatch");
      expect(result.args).toEqual(["workspace", "2"]);
    });

    it("should handle command options", async () => {
      const options: CommandOptions = {
        json: false,
        timeout: 2000,
        priority: "high",
        context: "test-context",
      };

      const result = await client.executeCommand("clients", [], options);

      expect(result.success).toBe(true);
      expect(mockRateLimiter.acquire).toHaveBeenCalledWith(1, 2000);
    });

    it("should apply rate limiting", async () => {
      await client.executeCommand("clients");

      expect(mockRateLimiter.acquire).toHaveBeenCalledWith(1, TEST_CONFIG.commandTimeout);
    });

    it("should format request correctly", async () => {
      await client.executeCommand("getoption", ["general:border_size"]);

      const mockConnection = mockConnectionPool.withConnection.mock.calls[0][0];
      const connection = {
        sendRequest: vi.fn().mockResolvedValue({
          type: "response",
          payload: { success: true, data: "2", error: undefined },
        }),
      };

      await mockConnection(connection);

      expect(connection.sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "request",
          payload: {
            command: "getoption",
            args: ["general:border_size"],
            json: true,
          },
          id: expect.any(String),
          timestamp: expect.any(Number),
        })
      );
    });
  });

  // ========================================================================
  // Error Handling Tests
  // ========================================================================

  describe("Error Handling", () => {
    it("should handle command validation errors", async () => {
      await expect(client.executeCommand("" as HyprCtlCommand)).rejects.toThrow(
        CommandValidationError
      );
    });

    it("should handle dispatch without arguments", async () => {
      await expect(client.executeCommand("dispatch")).rejects.toThrow(CommandValidationError);
    });

    it("should handle connection errors", async () => {
      const connectionError = new Error("Connection failed");
      mockConnectionPool.withConnection.mockRejectedValue(connectionError);

      await expect(client.executeCommand("clients")).rejects.toThrow(connectionError);
    });

    it("should handle command execution errors", async () => {
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: {
                success: false,
                data: undefined,
                error: "Invalid command argument",
              },
            }),
          };
          return fn(mockConnection);
        }
      );

      await expect(client.executeCommand("getoption", ["invalid"])).rejects.toThrow(
        CommandExecutionError
      );
    });

    it("should handle timeout errors", async () => {
      mockRateLimiter.acquire.mockRejectedValue(new Error("Rate limiter timeout after 1000ms"));

      await expect(client.executeCommand("clients")).rejects.toThrow();
    });

    it("should handle missing response payload", async () => {
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: null,
            }),
          };
          return fn(mockConnection);
        }
      );

      await expect(client.executeCommand("clients")).rejects.toThrow(CommandExecutionError);
    });
  });

  // ========================================================================
  // Caching Tests
  // ========================================================================

  describe("Caching", () => {
    beforeEach(() => {
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: {
                success: true,
                data: MOCK_WINDOW_DATA,
                error: undefined,
              },
            }),
          };
          return fn(mockConnection);
        }
      );
    });

    it("should cache successful results", async () => {
      // First call
      const result1 = await client.executeCommand("clients");
      expect(result1.fromCache).toBe(false);

      // Second call should be cached
      const result2 = await client.executeCommand("clients");
      expect(result2.fromCache).toBe(true);
      expect(result2.data).toEqual(result1.data);
    });

    it("should respect cache TTL", async () => {
      vi.useFakeTimers();

      // First call
      await client.executeCommand("clients");

      // Advance time beyond TTL
      vi.advanceTimersByTime(600);

      // Second call should not be cached
      const result = await client.executeCommand("clients");
      expect(result.fromCache).toBe(false);

      vi.useRealTimers();
    });

    it("should skip cache when requested", async () => {
      // First call to populate cache
      await client.executeCommand("clients");

      // Second call with skipCache
      const result = await client.executeCommand("clients", [], { skipCache: true });
      expect(result.fromCache).toBe(false);
    });

    it("should not cache failed results", async () => {
      mockConnectionPool.withConnection.mockImplementationOnce(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: {
                success: false,
                data: undefined,
                error: "Command failed",
              },
            }),
          };
          return fn(mockConnection);
        }
      );

      // First call fails
      await expect(client.executeCommand("clients")).rejects.toThrow();

      // Second call should not use cache
      mockConnectionPool.withConnection.mockImplementationOnce(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: {
                success: true,
                data: MOCK_WINDOW_DATA,
                error: undefined,
              },
            }),
          };
          return fn(mockConnection);
        }
      );

      const result = await client.executeCommand("clients");
      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(false);
    });

    it("should clear cache", async () => {
      // Populate cache
      await client.executeCommand("clients");

      // Clear cache
      client.clearCache();

      // Next call should not be cached
      const result = await client.executeCommand("clients");
      expect(result.fromCache).toBe(false);
    });
  });

  // ========================================================================
  // Batch Execution Tests
  // ========================================================================

  describe("Batch Execution", () => {
    beforeEach(() => {
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockImplementation(async () => {
              // Add small delay to simulate execution time
              await new Promise((resolve) => setTimeout(resolve, 1));
              return {
                type: "response",
                payload: {
                  success: true,
                  data: "OK",
                  error: undefined,
                },
              };
            }),
          };
          return fn(mockConnection);
        }
      );
    });

    it("should execute batch commands sequentially", async () => {
      const commands = [
        { command: "clients" as HyprCtlCommand },
        { command: "workspaces" as HyprCtlCommand },
        { command: "monitors" as HyprCtlCommand },
      ];

      const result = await client.executeBatch(commands);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.successCount).toBe(3);
      expect(result.errorCount).toBe(0);
      expect(result.totalExecutionTime).toBeGreaterThan(0);
    });

    it("should execute batch commands in parallel", async () => {
      const commands = [
        { command: "clients" as HyprCtlCommand },
        { command: "workspaces" as HyprCtlCommand },
      ];

      const batchOptions: BatchCommandOptions = {
        parallel: true,
        maxParallel: 2,
      };

      const result = await client.executeBatch(commands, batchOptions);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it("should handle mixed success/failure in batch", async () => {
      let callCount = 0;
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: {
                success: callCount++ === 0, // First call succeeds, second fails
                data: callCount === 1 ? "OK" : undefined,
                error: callCount === 1 ? undefined : "Command failed",
              },
            }),
          };
          return fn(mockConnection);
        }
      );

      const commands = [
        { command: "clients" as HyprCtlCommand },
        { command: "workspaces" as HyprCtlCommand },
      ];

      await expect(client.executeBatch(commands)).resolves.toMatchObject({
        success: false,
        successCount: 1,
        errorCount: 1,
      });
    });

    it("should stop on first error when configured", async () => {
      let callCount = 0;
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          if (callCount++ === 0) {
            throw new Error("First command failed");
          }

          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: { success: true, data: "OK", error: undefined },
            }),
          };
          return fn(mockConnection);
        }
      );

      const commands = [
        { command: "clients" as HyprCtlCommand },
        { command: "workspaces" as HyprCtlCommand },
      ];

      const result = await client.executeBatch(commands, { stopOnError: true });

      expect(result.results).toHaveLength(1); // Only first command executed
      expect(result.errorCount).toBe(1);
    });
  });

  // ========================================================================
  // History and Monitoring Tests
  // ========================================================================

  describe("History and Monitoring", () => {
    beforeEach(() => {
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockImplementation(async () => {
              // Add small delay to simulate execution time
              await new Promise((resolve) => setTimeout(resolve, 1));
              return {
                type: "response",
                payload: {
                  success: true,
                  data: "OK",
                  error: undefined,
                },
              };
            }),
          };
          return fn(mockConnection);
        }
      );
    });

    it("should track command history", async () => {
      await client.executeCommand("clients");
      await client.executeCommand("workspaces");

      const history = client.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].command).toBe("clients");
      expect(history[1].command).toBe("workspaces");
    });

    it("should limit history size", async () => {
      const limitedClient = new HyprCtlClient({
        ...TEST_CONFIG,
        maxHistorySize: 2,
      });

      // Set up mocks for the new client
      const poolConstructor = vi.mocked(SocketConnectionPool);
      const limitedMockPool =
        poolConstructor.mock.results[poolConstructor.mock.results.length - 1]?.value;

      if (limitedMockPool) {
        limitedMockPool.withConnection.mockImplementation(
          async (fn: (connection: unknown) => Promise<unknown>) => {
            const mockConnection = {
              sendRequest: vi.fn().mockImplementation(async () => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                return {
                  type: "response",
                  payload: {
                    success: true,
                    data: "OK",
                    error: undefined,
                  },
                };
              }),
            };
            return fn(mockConnection);
          }
        );
      }

      await limitedClient.executeCommand("clients");
      await limitedClient.executeCommand("workspaces");
      await limitedClient.executeCommand("monitors");

      const history = limitedClient.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].command).toBe("workspaces");
      expect(history[1].command).toBe("monitors");

      await limitedClient.close();
    });

    it("should clear history", async () => {
      await client.executeCommand("clients");

      client.clearHistory();

      const history = client.getHistory();
      expect(history).toHaveLength(0);
    });

    it("should get limited history", async () => {
      await client.executeCommand("clients");
      await client.executeCommand("workspaces");
      await client.executeCommand("monitors");

      const recentHistory = client.getHistory(2);
      expect(recentHistory).toHaveLength(2);
      expect(recentHistory[0].command).toBe("workspaces");
      expect(recentHistory[1].command).toBe("monitors");
    });

    it("should track performance metrics", async () => {
      await client.executeCommand("clients");
      await client.executeCommand("workspaces");

      const metrics = client.getMetrics();
      expect(metrics.totalCommands).toBe(2);
      expect(metrics.successfulCommands).toBe(2);
      expect(metrics.failedCommands).toBe(0);
      expect(metrics.averageExecutionTime).toBeGreaterThan(0);
      expect(metrics.commandsPerSecond).toBeGreaterThan(0);
    });

    it("should track cache hit rate", async () => {
      // First call (miss)
      await client.executeCommand("clients");
      // Second call (hit)
      await client.executeCommand("clients");

      const metrics = client.getMetrics();
      expect(metrics.cacheHitRate).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // Event Emission Tests
  // ========================================================================

  describe("Event Emission", () => {
    beforeEach(() => {
      mockConnectionPool.withConnection.mockImplementation(
        async (fn: (connection: unknown) => Promise<unknown>) => {
          const mockConnection = {
            sendRequest: vi.fn().mockResolvedValue({
              type: "response",
              payload: {
                success: true,
                data: "OK",
                error: undefined,
              },
            }),
          };
          return fn(mockConnection);
        }
      );
    });

    it("should emit command events", async () => {
      const commandEvents: unknown[] = [];
      client.on("command", (event) => commandEvents.push(event));

      await client.executeCommand("clients");

      expect(commandEvents).toHaveLength(1);
      expect(commandEvents[0]).toMatchObject({
        type: "success",
        command: "clients",
        executionId: expect.any(String),
      });
    });

    it("should emit batch events", async () => {
      const batchEvents: unknown[] = [];
      client.on("batch", (event) => batchEvents.push(event));

      const commands = [{ command: "clients" as HyprCtlCommand }];
      await client.executeBatch(commands);

      expect(batchEvents).toHaveLength(1);
      expect(batchEvents[0]).toMatchObject({
        type: "success",
        commands: 1,
      });
    });

    it("should emit cache events", async () => {
      const cacheEvents: unknown[] = [];
      client.on("cache", (event) => cacheEvents.push(event));

      client.clearCache();

      expect(cacheEvents).toHaveLength(1);
      expect(cacheEvents[0]).toMatchObject({
        type: "cleared",
      });
    });

    it("should emit history events", async () => {
      const historyEvents: unknown[] = [];
      client.on("history", (event) => historyEvents.push(event));

      client.clearHistory();

      expect(historyEvents).toHaveLength(1);
      expect(historyEvents[0]).toMatchObject({
        type: "cleared",
      });
    });
  });

  // ========================================================================
  // Lifecycle Tests
  // ========================================================================

  describe("Lifecycle", () => {
    it("should close client and clean up resources", async () => {
      await client.close();

      expect(mockConnectionPool.close).toHaveBeenCalledTimes(1);
    });

    it("should emit closed event", async () => {
      const closedEvents: unknown[] = [];
      client.on("closed", () => closedEvents.push("closed"));

      await client.close();

      expect(closedEvents).toContain("closed");
    });
  });

  // ========================================================================
  // Integration with Connection Pool Tests
  // ========================================================================

  describe("Connection Pool Integration", () => {
    it("should forward connection pool events", () => {
      const connectionEvents: unknown[] = [];
      client.on("connection_error", (event) => connectionEvents.push(event));
      client.on("connection", (event) => connectionEvents.push(event));

      // Simulate connection pool events
      const poolInstance = vi.mocked(SocketConnectionPool).mock.results[0].value;
      const mockOn = poolInstance.on as MockedFunction<
        (event: string, listener: (...args: unknown[]) => void) => void
      >;

      // Get the registered event handlers
      const errorHandler = mockOn.mock.calls.find((call) => call[0] === "error")?.[1];
      const createdHandler = mockOn.mock.calls.find((call) => call[0] === "connectionCreated")?.[1];

      // Trigger events
      if (errorHandler) errorHandler(new Error("Connection error"));
      if (createdHandler) createdHandler();

      expect(connectionEvents).toHaveLength(2);
    });
  });
});
