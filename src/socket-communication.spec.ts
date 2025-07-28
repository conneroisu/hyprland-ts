/**
 * Comprehensive unit tests for socket communication layer.
 *
 * Tests cover all aspects of the socket communication system including:
 * - Connection establishment and management
 * - Message framing and serialization
 * - Error handling and recovery
 * - State management and transitions
 * - Concurrency safety and thread safety
 * - Performance characteristics
 */

import { EventEmitter } from "node:events";
import { connect } from "node:net";
import { type MockedFunction, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferOverflowError,
  ConnectionState,
  ConnectionTimeoutError,
  MessageTimeoutError,
  SocketConnection,
  type SocketConnectionConfig,
  SocketError,
} from "./socket-communication.js";
import type { IPCMessage, IPCRequest, IPCResponse, SocketType } from "./types.js";

// ============================================================================
// Mock Setup
// ============================================================================

// Create a mock socket class that extends EventEmitter
class MockSocket extends EventEmitter {
  public destroyed = false;
  public connected = false;
  public connecting = false;

  write(_data: Buffer | string, callback?: (error?: Error) => void): boolean {
    // Simulate async write
    process.nextTick(() => {
      if (this.destroyed) {
        callback?.(new Error("Socket destroyed"));
      } else {
        callback?.();
      }
    });
    return true;
  }

  end(callback?: () => void): void {
    this.destroyed = true;
    process.nextTick(() => {
      this.emit("close");
      callback?.();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("close");
  }

  setNoDelay(_noDelay: boolean): void {
    // Mock implementation
  }

  setKeepAlive(_enable: boolean, _initialDelay?: number): void {
    // Mock implementation
  }

  // Helper methods for testing
  simulateConnect(): void {
    this.connected = true;
    this.connecting = false;
    // Emit connect event asynchronously to match real socket behavior
    process.nextTick(() => {
      this.emit("connect");
    });
  }

  simulateError(error: Error): void {
    this.emit("error", error);
  }

  simulateData(data: Buffer): void {
    this.emit("data", data);
  }

  simulateClose(): void {
    this.connected = false;
    this.emit("close");
  }
}

// Mock node:net module with proper hoisting - declare at top level
vi.mock("node:net", () => ({
  connect: vi.fn(),
}));

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_SOCKET_PATH = "/tmp/test-socket.sock";
const TEST_SOCKET_TYPE: SocketType = "command";

const DEFAULT_TEST_CONFIG: SocketConnectionConfig = {
  connectionTimeout: 1000,
  messageTimeout: 500,
  maxRetries: 2,
  initialRetryDelay: 50,
  maxRetryDelay: 200,
  maxBufferSize: 1024,
  keepAlive: false,
};

// ============================================================================
// Test Suite
// ============================================================================

describe("SocketConnection", () => {
  let mockSocket: MockSocket;
  let connection: SocketConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket = new MockSocket();
    // Mock connect to return a socket that auto-connects
    vi.mocked(connect).mockImplementation(() => {
      // Auto-connect the socket after a short delay to simulate real behavior
      process.nextTick(() => {
        mockSocket.simulateConnect();
      });
      return mockSocket;
    });
  });

  afterEach(async () => {
    if (connection) {
      await connection.close();
    }
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Construction and Configuration Tests
  // ========================================================================

  describe("Construction", () => {
    it("should create connection with default configuration", () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE);
      expect(connection).toBeInstanceOf(SocketConnection);
      expect(connection.getState()).toBe(ConnectionState.Disconnected);
    });

    it("should create connection with custom configuration", () => {
      const config: SocketConnectionConfig = {
        connectionTimeout: 2000,
        messageTimeout: 1000,
        maxRetries: 5,
      };

      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, config);
      expect(connection).toBeInstanceOf(SocketConnection);
    });

    it("should initialize with correct default state", () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE);
      expect(connection.getState()).toBe(ConnectionState.Disconnected);
      expect(connection.isConnected()).toBe(false);
    });
  });

  // ========================================================================
  // Connection Management Tests
  // ========================================================================

  describe("Connection Management", () => {
    beforeEach(() => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
    });

    it("should establish connection successfully", async () => {
      const connectPromise = connection.connect();

      // Socket will auto-connect via mock implementation
      await expect(connectPromise).resolves.toBeUndefined();
      expect(connection.getState()).toBe(ConnectionState.Connected);
      expect(connection.isConnected()).toBe(true);
    });

    it("should handle connection timeout", async () => {
      // Create connection with 0 retries to avoid reconnection
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, {
        ...DEFAULT_TEST_CONFIG,
        maxRetries: 0,
      });

      // Override mock to not auto-connect for this test
      vi.mocked(connect).mockImplementation(() => {
        const socket = new MockSocket();
        // Don't auto-connect - let it timeout
        return socket;
      });

      const connectPromise = connection.connect();

      await expect(connectPromise).rejects.toThrow(ConnectionTimeoutError);
      // Wait a bit for state to settle
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(connection.getState()).toBe(ConnectionState.Error);
    });

    it("should handle connection error", async () => {
      // Override mock to emit error instead of connecting
      vi.mocked(connect).mockImplementation(() => {
        const socket = new MockSocket();
        process.nextTick(() => {
          socket.simulateError(new Error("Connection refused"));
        });
        return socket;
      });

      const connectPromise = connection.connect();

      await expect(connectPromise).rejects.toThrow(SocketError);
    });

    it("should not connect if already connected", async () => {
      // First connection will auto-connect
      const connectPromise1 = connection.connect();
      await connectPromise1;

      // Second connection should return immediately
      const connectPromise2 = connection.connect();
      await expect(connectPromise2).resolves.toBeUndefined();
    });

    it("should handle concurrent connection attempts", async () => {
      const connectPromise1 = connection.connect();
      const connectPromise2 = connection.connect();

      // Socket will auto-connect for both attempts
      await expect(Promise.all([connectPromise1, connectPromise2])).resolves.toEqual([
        undefined,
        undefined,
      ]);
    });
  });

  // ========================================================================
  // Message Handling Tests
  // ========================================================================

  describe("Message Handling", () => {
    beforeEach(async () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
      const connectPromise = connection.connect();
      // Socket will auto-connect via mock implementation
      await connectPromise;
    });

    it("should send message successfully", async () => {
      const message: IPCMessage = {
        type: "request",
        payload: { command: "test", args: ["arg1"] },
        timestamp: Date.now(),
      };

      const sendPromise = connection.sendMessage(message);
      await expect(sendPromise).resolves.toBeUndefined();
    });

    it("should reject message sending when not connected", async () => {
      await connection.close();

      const message: IPCMessage = {
        type: "request",
        payload: { command: "test" },
      };

      await expect(connection.sendMessage(message)).rejects.toThrow(SocketError);
    });

    it("should handle message sending errors", async () => {
      const message: IPCMessage = {
        type: "request",
        payload: { command: "test" },
      };

      // Mock write to fail
      vi.spyOn(mockSocket, "write").mockImplementation((_data, callback) => {
        callback?.(new Error("Write failed"));
        return false;
      });

      await expect(connection.sendMessage(message)).rejects.toThrow(SocketError);
    });

    it("should handle request-response cycle", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: { command: "test", args: [] },
        id: "test-123",
      };

      const responsePromise = connection.sendRequest(request);

      // Simulate response
      const response: IPCResponse = {
        type: "response",
        payload: { success: true, data: "test result" },
        id: "test-123",
      };

      const responseData = Buffer.from(`${JSON.stringify(response)}\n`);
      mockSocket.simulateData(responseData);

      const result = await responsePromise;
      expect(result).toEqual(response);
    });

    it("should handle request timeout", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: { command: "test" },
        id: "timeout-test",
      };

      // Don't send response - let it timeout
      await expect(connection.sendRequest(request)).rejects.toThrow(MessageTimeoutError);
    });

    it("should handle multiple concurrent requests", async () => {
      const requests = Array.from({ length: 5 }, (_, i) => ({
        type: "request" as const,
        payload: { command: "test", args: [i.toString()] },
        id: `req-${i}`,
      }));

      const promises = requests.map((req) => connection.sendRequest(req));

      // Send responses in reverse order to test proper matching
      for (let i = requests.length - 1; i >= 0; i--) {
        const response: IPCResponse = {
          type: "response",
          payload: { success: true, data: `result-${i}` },
          id: `req-${i}`,
        };

        const responseData = Buffer.from(`${JSON.stringify(response)}\n`);
        mockSocket.simulateData(responseData);
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      results.forEach((result, i) => {
        expect(result.id).toBe(`req-${i}`);
      });
    });
  });

  // ========================================================================
  // Message Framing Tests
  // ========================================================================

  describe("Message Framing", () => {
    beforeEach(async () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
      const connectPromise = connection.connect();
      // Socket will auto-connect via mock implementation
      await connectPromise;
    });

    it("should handle complete messages", async () => {
      const eventPromise = new Promise<IPCMessage>((resolve) => {
        connection.once("event", resolve);
      });

      const message = { type: "event", payload: { event: "test" } };
      const messageData = Buffer.from(`${JSON.stringify(message)}\n`);
      mockSocket.simulateData(messageData);

      const receivedMessage = await eventPromise;
      expect(receivedMessage).toEqual(message);
    });

    it("should handle partial messages", async () => {
      const eventPromise = new Promise<IPCMessage>((resolve) => {
        connection.once("message", resolve);
      });

      const message = { type: "notification", payload: { event: "partial-test" } };
      const messageStr = `${JSON.stringify(message)}\n`;

      // Send message in parts
      const part1 = Buffer.from(messageStr.slice(0, 10));
      const part2 = Buffer.from(messageStr.slice(10));

      mockSocket.simulateData(part1);
      mockSocket.simulateData(part2);

      const receivedMessage = await eventPromise;
      expect(receivedMessage).toEqual(message);
    });

    it("should handle multiple messages in single buffer", async () => {
      const messages: IPCMessage[] = [];
      connection.on("message", (msg) => messages.push(msg));

      const message1 = { type: "notification", payload: { event: "test1" } };
      const message2 = { type: "notification", payload: { event: "test2" } };

      const combinedData = Buffer.from(
        `${JSON.stringify(message1)}\n${JSON.stringify(message2)}\n`
      );

      mockSocket.simulateData(combinedData);

      // Wait for messages to be processed
      await new Promise((resolve) => process.nextTick(resolve));

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual(message1);
      expect(messages[1]).toEqual(message2);
    });

    it("should handle buffer overflow", async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        connection.once("error", resolve);
      });

      // Send data larger than buffer size
      const largeBuffer = Buffer.alloc(2048, "x"); // Larger than 1024 buffer size
      mockSocket.simulateData(largeBuffer);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(BufferOverflowError);
    });

    it("should handle malformed JSON", async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        connection.once("error", resolve);
      });

      const malformedData = Buffer.from("{ invalid json \n");
      mockSocket.simulateData(malformedData);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(SocketError);
      expect(error.code).toBe("DESERIALIZE_FAILED");
    });
  });

  // ========================================================================
  // State Management Tests
  // ========================================================================

  describe("State Management", () => {
    beforeEach(() => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
    });

    it("should track state transitions correctly", async () => {
      const states: ConnectionState[] = [];
      connection.on("stateChange", (newState) => states.push(newState));

      // Connect (socket will auto-connect)
      const connectPromise = connection.connect();
      await connectPromise;

      // Close
      await connection.close();

      expect(states).toEqual([
        ConnectionState.Connecting,
        ConnectionState.Connected,
        ConnectionState.Closing,
        ConnectionState.Closed,
      ]);
    });

    it("should emit appropriate events", async () => {
      const events: string[] = [];
      connection.on("connected", () => events.push("connected"));
      connection.on("disconnected", () => events.push("disconnected"));
      connection.on("closed", () => events.push("closed"));

      // Connect
      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;

      // Simulate disconnection
      mockSocket.simulateClose();
      await new Promise((resolve) => process.nextTick(resolve));

      expect(events).toContain("connected");
      expect(events).toContain("disconnected");
    });

    it("should provide accurate connection status", () => {
      expect(connection.isConnected()).toBe(false);
      expect(connection.getState()).toBe(ConnectionState.Disconnected);
    });
  });

  // ========================================================================
  // Error Handling and Recovery Tests
  // ========================================================================

  describe("Error Handling and Recovery", () => {
    beforeEach(() => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
    });

    it("should handle socket errors gracefully", async () => {
      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;

      const errorPromise = new Promise<Error>((resolve) => {
        connection.once("error", resolve);
      });

      mockSocket.simulateError(new Error("Socket error"));

      const error = await errorPromise;
      expect(error).toBeInstanceOf(SocketError);
    });

    it("should attempt reconnection on disconnect", async () => {
      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;

      const reconnectingPromise = new Promise<void>((resolve) => {
        connection.once("reconnecting", resolve);
      });

      mockSocket.simulateClose();
      await reconnectingPromise;

      expect(connection.getState()).toBe(ConnectionState.Reconnecting);
    });

    it("should respect retry limits", async () => {
      let connectAttempts = 0;
      vi.mocked(connect).mockImplementation(() => {
        connectAttempts++;
        const socket = new MockSocket();
        process.nextTick(() => socket.simulateError(new Error("Connection failed")));
        return socket;
      });

      await expect(connection.connect()).rejects.toThrow();

      // Wait for all retries to complete (initial delay is 50ms, then 100ms)
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(connectAttempts).toBe(3); // Initial + 2 retries
    });

    it("should clean up resources on close", async () => {
      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;

      // Create pending request
      const requestPromise = connection.sendRequest({
        type: "request",
        payload: { command: "test" },
        id: "cleanup-test",
      });

      // Close connection
      await connection.close();

      // Pending request should be rejected
      await expect(requestPromise).rejects.toThrow(SocketError);
    });
  });

  // ========================================================================
  // Statistics and Monitoring Tests
  // ========================================================================

  describe("Statistics and Monitoring", () => {
    beforeEach(async () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;
    });

    it("should track connection statistics", async () => {
      const stats = connection.getStats();
      expect(stats.connectionsSuccessful).toBe(1);
      expect(stats.connectionsFailed).toBe(0);
      expect(stats.state).toBe(ConnectionState.Connected);
    });

    it("should track message statistics", async () => {
      const message: IPCMessage = {
        type: "request",
        payload: { command: "test" },
      };

      await connection.sendMessage(message);

      const stats = connection.getStats();
      expect(stats.messagesSent).toBe(1);
      expect(stats.bytesSent).toBeGreaterThan(0);
    });

    it("should calculate uptime correctly", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = connection.getStats();
      expect(stats.uptime).toBeGreaterThan(0);
    });

    it("should track round-trip time", async () => {
      const request: IPCRequest = {
        type: "request",
        payload: { command: "rtt-test" },
        id: "rtt-123",
      };

      const responsePromise = connection.sendRequest(request);

      // Small delay before response
      await new Promise((resolve) => setTimeout(resolve, 5));

      const response: IPCResponse = {
        type: "response",
        payload: { success: true },
        id: "rtt-123",
      };

      const responseData = Buffer.from(`${JSON.stringify(response)}\n`);
      mockSocket.simulateData(responseData);

      await responsePromise;

      const stats = connection.getStats();
      expect(stats.averageRtt).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // Concurrency Safety Tests
  // ========================================================================

  describe("Concurrency Safety", () => {
    beforeEach(async () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;
    });

    it("should handle concurrent message sending", async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        type: "request" as const,
        payload: { command: "concurrent", index: i },
      }));

      const promises = messages.map((msg) => connection.sendMessage(msg));
      await expect(Promise.all(promises)).resolves.toHaveLength(10);
    });

    it("should handle concurrent state changes", async () => {
      const operations = Array.from({ length: 5 }, () =>
        connection.connect().catch(() => {
          /* ignore errors */
        })
      );

      await Promise.allSettled(operations);
      expect(connection.isConnected()).toBe(true);
    });

    it("should respect rate limiting", async () => {
      // Test rate limiting by sending messages within burst capacity - should be fast
      const burstMessages = Array.from({ length: 10 }, (_, i) => ({
        type: "request" as const,
        payload: { command: "burst-test", index: i },
      }));

      const startTime = Date.now();
      const promises = burstMessages.map((msg) => connection.sendMessage(msg));
      await Promise.all(promises);
      const endTime = Date.now();

      // Within burst capacity should be relatively fast (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);

      // All messages should be sent successfully
      expect(promises).toHaveLength(10);
    });
  });

  // ========================================================================
  // Edge Cases and Boundary Tests
  // ========================================================================

  describe("Edge Cases", () => {
    it("should handle null socket path", () => {
      expect(() => new SocketConnection("", TEST_SOCKET_TYPE)).not.toThrow();
    });

    it("should handle invalid configuration values", () => {
      const config: SocketConnectionConfig = {
        connectionTimeout: -1,
        messageTimeout: -1,
        maxRetries: -1,
      };

      expect(() => new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, config)).not.toThrow();
    });

    it("should handle closing during connection", async () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);

      const connectPromise = connection.connect();
      const closePromise = connection.close();

      mockSocket.simulateConnect();

      await expect(Promise.allSettled([connectPromise, closePromise])).resolves.toBeDefined();
    });

    it("should handle multiple close calls", async () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE);

      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;

      const closePromises = Array.from({ length: 3 }, () => connection.close());
      await expect(Promise.all(closePromises)).resolves.toHaveLength(3);
    });

    it("should handle empty messages", async () => {
      connection = new SocketConnection(TEST_SOCKET_PATH, TEST_SOCKET_TYPE, DEFAULT_TEST_CONFIG);
      const connectPromise = connection.connect();
      mockSocket.simulateConnect();
      await connectPromise;

      const emptyMessage: IPCMessage = {
        type: "request",
        payload: null,
      };

      await expect(connection.sendMessage(emptyMessage)).resolves.toBeUndefined();
    });
  });
});
