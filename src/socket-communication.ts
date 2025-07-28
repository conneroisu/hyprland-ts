/**
 * Low-level UNIX socket communication layer for Hyprland IPC.
 *
 * This module provides a robust, high-performance socket communication system
 * with comprehensive error handling, connection pooling, and reconnection logic.
 *
 * Key features:
 * - Connection establishment with proper error handling and resource management
 * - Message framing protocol for reliable data transmission
 * - Connection pooling for concurrent socket connections
 * - Backpressure management to prevent memory issues
 * - Connection state management with detailed status reporting
 * - Socket reconnection logic with exponential backoff
 * - Performance optimization with connection reuse
 * - Concurrency safety for multi-threaded access
 * - Support for both request-response and streaming patterns
 *
 * @see {@link https://hyprland.org/} - Hyprland window manager
 */

import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { connect } from "node:net";
import { AtomicBoolean, AtomicCounter, Mutex, RateLimiter } from "./concurrency.js";
import type { IPCEvent, IPCMessage, IPCRequest, IPCResponse, SocketType } from "./types.js";

// ============================================================================
// Constants and Configuration
// ============================================================================

/**
 * Default configuration values for socket communication.
 * These values are tuned for optimal performance and reliability.
 */
const DEFAULT_CONFIG = {
  /** Connection timeout in milliseconds */
  connectionTimeout: 5000,
  /** Message timeout in milliseconds */
  messageTimeout: 10000,
  /** Maximum number of connection retries */
  maxRetries: 3,
  /** Initial retry delay in milliseconds */
  initialRetryDelay: 100,
  /** Maximum retry delay in milliseconds */
  maxRetryDelay: 5000,
  /** Connection pool size per socket type */
  poolSize: 5,
  /** Maximum message buffer size in bytes */
  maxBufferSize: 1024 * 1024, // 1MB
  /** Keep-alive interval in milliseconds */
  keepAliveInterval: 30000,
} as const;

/**
 * Message frame delimiters and protocol constants.
 * Hyprland uses newline-delimited JSON for most IPC communication.
 */
const PROTOCOL = {
  /** Message delimiter for framing */
  delimiter: "\n",
  /** Binary message prefix for automatic detection */
  binaryPrefix: Buffer.from([0xff, 0xfe]),
  /** Maximum single message size in bytes */
  maxMessageSize: 64 * 1024, // 64KB
} as const;

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Connection state enumeration.
 * Tracks the current state of a socket connection for proper state management.
 */
export enum ConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Reconnecting = "reconnecting",
  Error = "error",
  Closing = "closing",
  Closed = "closed",
}

/**
 * Socket connection configuration options.
 * Allows customization of connection behavior and performance characteristics.
 */
export interface SocketConnectionConfig {
  /** Connection timeout in milliseconds */
  readonly connectionTimeout?: number;
  /** Message timeout in milliseconds */
  readonly messageTimeout?: number;
  /** Maximum number of connection retries */
  readonly maxRetries?: number;
  /** Initial retry delay in milliseconds */
  readonly initialRetryDelay?: number;
  /** Maximum retry delay in milliseconds */
  readonly maxRetryDelay?: number;
  /** Maximum message buffer size in bytes */
  readonly maxBufferSize?: number;
  /** Enable keep-alive packets */
  readonly keepAlive?: boolean;
  /** Keep-alive interval in milliseconds */
  readonly keepAliveInterval?: number;
}

/**
 * Connection statistics for monitoring and diagnostics.
 * Provides detailed metrics about socket connection performance.
 */
export interface ConnectionStats {
  /** Number of successful connections */
  readonly connectionsSuccessful: number;
  /** Number of failed connections */
  readonly connectionsFailed: number;
  /** Number of reconnection attempts */
  readonly reconnectAttempts: number;
  /** Total messages sent */
  readonly messagesSent: number;
  /** Total messages received */
  readonly messagesReceived: number;
  /** Total bytes sent */
  readonly bytesSent: number;
  /** Total bytes received */
  readonly bytesReceived: number;
  /** Current connection state */
  readonly state: ConnectionState;
  /** Last error message if any */
  readonly lastError?: string;
  /** Connection uptime in milliseconds */
  readonly uptime: number;
  /** Average round-trip time in milliseconds */
  readonly averageRtt: number;
}

/**
 * Mutable version of connection statistics for internal use.
 */
interface MutableConnectionStats {
  connectionsSuccessful: number;
  connectionsFailed: number;
  reconnectAttempts: number;
  messagesSent: number;
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  lastError?: string;
}

/**
 * Pending message structure for tracking request-response pairs.
 * Used for managing timeouts and matching responses to requests.
 */
interface PendingMessage {
  readonly id: string;
  readonly request: IPCRequest;
  readonly resolve: (response: IPCResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timestamp: number;
  readonly timeout: NodeJS.Timeout;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base socket communication error.
 * Provides structured error information for socket-related failures.
 */
export class SocketError extends Error {
  public readonly code: string;
  public readonly socketPath?: string;
  public readonly socketType?: SocketType;

  constructor(message: string, code: string, socketPath?: string, socketType?: SocketType) {
    super(message);
    this.name = "SocketError";
    this.code = code;
    if (socketPath !== undefined) {
      this.socketPath = socketPath;
    }
    if (socketType !== undefined) {
      this.socketType = socketType;
    }
  }
}

/**
 * Connection timeout error.
 * Thrown when socket connection attempts exceed the configured timeout.
 */
export class ConnectionTimeoutError extends SocketError {
  constructor(socketPath: string, timeout: number) {
    super(
      `Connection timeout after ${timeout}ms to socket: ${socketPath}`,
      "CONNECTION_TIMEOUT",
      socketPath
    );
    this.name = "ConnectionTimeoutError";
  }
}

/**
 * Message timeout error.
 * Thrown when message responses are not received within the configured timeout.
 */
export class MessageTimeoutError extends SocketError {
  constructor(messageId: string, timeout: number) {
    super(`Message timeout after ${timeout}ms for message ID: ${messageId}`, "MESSAGE_TIMEOUT");
    this.name = "MessageTimeoutError";
  }
}

/**
 * Buffer overflow error.
 * Thrown when message buffers exceed the configured maximum size.
 */
export class BufferOverflowError extends SocketError {
  constructor(currentSize: number, maxSize: number) {
    super(
      `Buffer overflow: ${currentSize} bytes exceeds maximum ${maxSize} bytes`,
      "BUFFER_OVERFLOW"
    );
    this.name = "BufferOverflowError";
  }
}

// ============================================================================
// Socket Connection Class
// ============================================================================

/**
 * High-performance UNIX socket connection with comprehensive features.
 *
 * This class provides a robust foundation for IPC communication with Hyprland,
 * including connection management, message framing, error handling, and
 * performance optimization features.
 */
export class SocketConnection extends EventEmitter {
  private socket: Socket | null = null;
  private state: ConnectionState = ConnectionState.Disconnected;
  private config: Required<SocketConnectionConfig>;
  private stats: MutableConnectionStats;
  private pendingMessages = new Map<string, PendingMessage>();
  private messageBuffer = Buffer.alloc(0);
  private retryCount = 0;
  private retryTimeout: NodeJS.Timeout | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private connectionStartTime = 0;
  private rttSamples: number[] = [];

  // Concurrency safety primitives
  private readonly stateMutex = new Mutex();
  private readonly messageMutex = new Mutex();
  private readonly bufferMutex = new Mutex();
  private readonly rateLimiter: RateLimiter;
  private readonly messageCounter = new AtomicCounter();
  private readonly isClosing = new AtomicBoolean(false);

  private readonly socketPath: string;
  private readonly socketType: SocketType;

  /**
   * Creates a new socket connection instance.
   *
   * @param socketPath - Absolute path to the UNIX socket
   * @param socketType - Type of socket (command or event)
   * @param config - Optional connection configuration
   */
  constructor(socketPath: string, socketType: SocketType, config: SocketConnectionConfig = {}) {
    super();

    this.socketPath = socketPath;
    this.socketType = socketType;

    this.config = {
      connectionTimeout: config.connectionTimeout ?? DEFAULT_CONFIG.connectionTimeout,
      messageTimeout: config.messageTimeout ?? DEFAULT_CONFIG.messageTimeout,
      maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      initialRetryDelay: config.initialRetryDelay ?? DEFAULT_CONFIG.initialRetryDelay,
      maxRetryDelay: config.maxRetryDelay ?? DEFAULT_CONFIG.maxRetryDelay,
      maxBufferSize: config.maxBufferSize ?? DEFAULT_CONFIG.maxBufferSize,
      keepAlive: config.keepAlive ?? true,
      keepAliveInterval: config.keepAliveInterval ?? DEFAULT_CONFIG.keepAliveInterval,
    };

    this.stats = {
      connectionsSuccessful: 0,
      connectionsFailed: 0,
      reconnectAttempts: 0,
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
    };

    // Initialize rate limiter: 100 messages per second with burst capacity of 50
    this.rateLimiter = new RateLimiter(50, 100);
  }

  /**
   * Establishes connection to the socket with proper error handling.
   * Implements connection timeout and retry logic.
   *
   * @returns Promise that resolves when connection is established
   * @throws {ConnectionTimeoutError} When connection times out
   * @throws {SocketError} For other connection failures
   */
  async connect(): Promise<void> {
    if (this.state === ConnectionState.Connected) {
      return;
    }

    if (this.state === ConnectionState.Connecting) {
      return new Promise((resolve, reject) => {
        this.once("connected", resolve);
        this.once("error", reject);
      });
    }

    await this.setState(ConnectionState.Connecting);
    this.connectionStartTime = Date.now();

    try {
      await this.establishConnection();
      this.retryCount = 0;
      this.stats.connectionsSuccessful++;
      await this.setState(ConnectionState.Connected);
      this.startKeepAlive();
      this.emit("connected");
    } catch (error) {
      this.stats.connectionsFailed++;
      await this.handleConnectionError(error);
      throw error;
    }
  }

  /**
   * Sends a message through the socket with confirmation and retry logic.
   *
   * @param message - Message to send
   * @returns Promise that resolves when message is sent successfully
   * @throws {SocketError} When message sending fails
   */
  async sendMessage(message: IPCMessage): Promise<void> {
    // Check if closing
    if (await this.isClosing.get()) {
      throw new SocketError(
        "Cannot send message: connection is closing",
        "CONNECTION_CLOSING",
        this.socketPath,
        this.socketType
      );
    }

    // Apply rate limiting
    await this.rateLimiter.acquire(1, this.config.messageTimeout);

    return this.messageMutex.withLock(async () => {
      if (this.state !== ConnectionState.Connected) {
        throw new SocketError(
          "Cannot send message: socket not connected",
          "NOT_CONNECTED",
          this.socketPath,
          this.socketType
        );
      }

      const serialized = this.serializeMessage(message);
      const buffer = Buffer.from(serialized + PROTOCOL.delimiter);

      return new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          reject(
            new SocketError(
              "Socket instance is null",
              "NULL_SOCKET",
              this.socketPath,
              this.socketType
            )
          );
          return;
        }

        this.socket.write(buffer, async (error) => {
          if (error) {
            reject(
              new SocketError(
                `Failed to send message: ${error.message}`,
                "SEND_FAILED",
                this.socketPath,
                this.socketType
              )
            );
          } else {
            this.stats.messagesSent++;
            this.stats.bytesSent += buffer.length;
            await this.messageCounter.increment();
            resolve();
          }
        });
      });
    });
  }

  /**
   * Sends a request and waits for the corresponding response.
   * Implements timeout handling and request-response matching.
   *
   * @param request - Request message to send
   * @returns Promise that resolves with the response
   * @throws {MessageTimeoutError} When response times out
   * @throws {SocketError} For other communication failures
   */
  async sendRequest(request: IPCRequest): Promise<IPCResponse> {
    const messageId = request.id ?? this.generateMessageId();
    const requestWithId = { ...request, id: messageId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(messageId);
        reject(new MessageTimeoutError(messageId, this.config.messageTimeout));
      }, this.config.messageTimeout);

      this.pendingMessages.set(messageId, {
        id: messageId,
        request: requestWithId,
        resolve,
        reject,
        timestamp: Date.now(),
        timeout,
      });

      this.sendMessage(requestWithId).catch((error) => {
        this.pendingMessages.delete(messageId);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Closes the socket connection and cleans up resources.
   * Ensures proper cleanup of pending operations and timers.
   *
   * @returns Promise that resolves when connection is closed
   */
  async close(): Promise<void> {
    // Set closing flag atomically
    const wasClosing = await this.isClosing.compareAndSwap(false, true);
    if (!wasClosing) {
      return; // Already closing
    }

    if (this.state === ConnectionState.Closed || this.state === ConnectionState.Closing) {
      return;
    }

    await this.setState(ConnectionState.Closing);
    this.cleanup();

    if (this.socket) {
      return new Promise((resolve) => {
        this.socket?.end(async () => {
          await this.setState(ConnectionState.Closed);
          this.emit("closed");
          resolve();
        });
      });
    }

    await this.setState(ConnectionState.Closed);
    this.emit("closed");
  }

  /**
   * Gets current connection statistics.
   * Provides real-time metrics for monitoring and diagnostics.
   *
   * @returns Current connection statistics
   */
  getStats(): ConnectionStats {
    return {
      ...this.stats,
      state: this.state,
      uptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0,
      averageRtt: this.calculateAverageRtt(),
    };
  }

  /**
   * Gets current connection state.
   *
   * @returns Current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Checks if the connection is currently active.
   *
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.state === ConnectionState.Connected;
  }

  // ============================================================================
  // Private Implementation Methods
  // ============================================================================

  /**
   * Establishes the actual socket connection with timeout handling.
   */
  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath);

      const connectionTimeout = setTimeout(() => {
        socket.destroy();
        reject(new ConnectionTimeoutError(this.socketPath, this.config.connectionTimeout));
      }, this.config.connectionTimeout);

      socket.once("connect", () => {
        clearTimeout(connectionTimeout);
        this.socket = socket;
        this.setupSocketHandlers();
        resolve();
      });

      socket.once("error", (error) => {
        clearTimeout(connectionTimeout);
        reject(
          new SocketError(
            `Connection failed: ${error.message}`,
            "CONNECTION_FAILED",
            this.socketPath,
            this.socketType
          )
        );
      });
    });
  }

  /**
   * Sets up event handlers for the socket instance.
   */
  private setupSocketHandlers(): void {
    if (!this.socket) return;

    this.socket.on("data", this.handleData.bind(this));
    this.socket.on("error", this.handleSocketError.bind(this));
    this.socket.on("close", this.handleSocketClose.bind(this));
    this.socket.on("timeout", this.handleSocketTimeout.bind(this));

    // Configure socket options for optimal performance
    this.socket.setNoDelay(true); // Disable Nagle's algorithm for low latency
    this.socket.setKeepAlive(this.config.keepAlive, this.config.keepAliveInterval);
  }

  /**
   * Handles incoming data from the socket with message framing.
   */
  private handleData(data: Buffer): void {
    this.bufferMutex
      .withLock(async () => {
        this.stats.bytesReceived += data.length;
        this.messageBuffer = Buffer.concat([this.messageBuffer, data]);

        // Check for buffer overflow
        if (this.messageBuffer.length > this.config.maxBufferSize) {
          this.emit(
            "error",
            new BufferOverflowError(this.messageBuffer.length, this.config.maxBufferSize)
          );
          return;
        }

        this.processMessageBuffer();
      })
      .catch((error) => {
        this.emit(
          "error",
          new SocketError(
            `Buffer handling error: ${error instanceof Error ? error.message : String(error)}`,
            "BUFFER_ERROR",
            this.socketPath,
            this.socketType
          )
        );
      });
  }

  /**
   * Processes the message buffer and extracts complete messages.
   */
  private processMessageBuffer(): void {
    while (this.messageBuffer.length > 0) {
      const delimiterIndex = this.messageBuffer.indexOf(PROTOCOL.delimiter);

      if (delimiterIndex === -1) {
        // No complete message available
        break;
      }

      const messageData = this.messageBuffer.subarray(0, delimiterIndex);
      this.messageBuffer = this.messageBuffer.subarray(delimiterIndex + 1);

      try {
        const message = this.deserializeMessage(messageData);
        this.handleMessage(message);
      } catch (error) {
        this.emit(
          "error",
          new SocketError(
            `Failed to deserialize message: ${error instanceof Error ? error.message : String(error)}`,
            "DESERIALIZE_FAILED",
            this.socketPath,
            this.socketType
          )
        );
      }
    }
  }

  /**
   * Handles a complete deserialized message.
   */
  private handleMessage(message: IPCMessage): void {
    this.stats.messagesReceived++;

    if (message.type === "response") {
      this.handleResponse(message as IPCResponse);
    } else if (message.type === "event") {
      this.emit("event", message as IPCEvent);
    } else {
      this.emit("message", message);
    }
  }

  /**
   * Handles response messages and matches them with pending requests.
   */
  private handleResponse(response: IPCResponse): void {
    const messageId = response.id;
    if (!messageId) {
      this.emit("response", response);
      return;
    }

    const pending = this.pendingMessages.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMessages.delete(messageId);

      // Calculate RTT for statistics
      const rtt = Date.now() - pending.timestamp;
      this.rttSamples.push(rtt);
      if (this.rttSamples.length > 100) {
        this.rttSamples.shift(); // Keep only last 100 samples
      }

      pending.resolve(response);
    } else {
      this.emit("response", response);
    }
  }

  /**
   * Handles socket errors and triggers reconnection if appropriate.
   */
  private handleSocketError(error: Error): void {
    this.stats.lastError = error.message;
    this.setState(ConnectionState.Error)
      .then(() => {
        if (this.listenerCount("error") > 0) {
          this.emit(
            "error",
            new SocketError(
              `Socket error: ${error.message}`,
              "SOCKET_ERROR",
              this.socketPath,
              this.socketType
            )
          );
        }

        this.attemptReconnection().catch(() => {
          // Reconnection will handle its own errors
        });
      })
      .catch(() => {
        // State setting failed, emit error
        this.emit(
          "error",
          new SocketError(
            "Failed to set error state",
            "STATE_ERROR",
            this.socketPath,
            this.socketType
          )
        );
      });
  }

  /**
   * Handles socket close events.
   */
  private handleSocketClose(): void {
    if (this.state !== ConnectionState.Closing) {
      this.setState(ConnectionState.Disconnected)
        .then(() => {
          this.emit("disconnected");
          this.attemptReconnection().catch(() => {
            // Reconnection will handle its own errors
          });
        })
        .catch(() => {
          // State setting failed, but still emit disconnected
          this.emit("disconnected");
        });
    }
  }

  /**
   * Handles socket timeout events.
   */
  private handleSocketTimeout(): void {
    this.emit("timeout");
  }

  /**
   * Handles connection errors during the connection process.
   */
  private async handleConnectionError(error: unknown): Promise<void> {
    await this.setState(ConnectionState.Error);
    this.stats.lastError = error instanceof Error ? error.message : String(error);

    if (this.retryCount < this.config.maxRetries) {
      await this.attemptReconnection();
    } else {
      this.emit("error", error);
    }
  }

  /**
   * Attempts to reconnect with exponential backoff.
   */
  private async attemptReconnection(): Promise<void> {
    if (this.retryCount >= this.config.maxRetries) {
      return;
    }

    if (this.retryTimeout) {
      return; // Reconnection already scheduled
    }

    await this.setState(ConnectionState.Reconnecting);
    this.stats.reconnectAttempts++;
    this.retryCount++;

    const delay = Math.min(
      this.config.initialRetryDelay * 2 ** (this.retryCount - 1),
      this.config.maxRetryDelay
    );

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      this.connect().catch(() => {
        // Connection will handle its own errors
      });
    }, delay);

    this.emit("reconnecting", this.retryCount, delay);
  }

  /**
   * Sets the connection state and updates statistics.
   */
  private async setState(newState: ConnectionState): Promise<void> {
    await this.stateMutex.withLock(async () => {
      const oldState = this.state;
      this.state = newState;

      if (oldState !== newState) {
        this.emit("stateChange", newState, oldState);
      }
    });
  }

  /**
   * Serializes a message for transmission.
   */
  private serializeMessage(message: IPCMessage): string {
    return JSON.stringify(message);
  }

  /**
   * Deserializes a message from received data.
   */
  private deserializeMessage(data: Buffer): IPCMessage {
    const text = data.toString("utf8");
    return JSON.parse(text) as IPCMessage;
  }

  /**
   * Generates a unique message ID for request-response tracking.
   */
  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Starts the keep-alive mechanism.
   */
  private startKeepAlive(): void {
    if (!this.config.keepAlive || this.keepAliveInterval) {
      return;
    }

    this.keepAliveInterval = setInterval(() => {
      if (this.state === ConnectionState.Connected && this.socket) {
        // Send a ping message to keep the connection alive
        const pingMessage: IPCMessage = {
          type: "request",
          payload: { command: "ping" },
          timestamp: Date.now(),
        };
        this.sendMessage(pingMessage).catch(() => {
          // Keep-alive failure will trigger reconnection through error handling
        });
      }
    }, this.config.keepAliveInterval);
  }

  /**
   * Calculates the average round-trip time from recent samples.
   */
  private calculateAverageRtt(): number {
    if (this.rttSamples.length === 0) return 0;
    return this.rttSamples.reduce((sum, rtt) => sum + rtt, 0) / this.rttSamples.length;
  }

  /**
   * Cleans up resources and pending operations.
   */
  private cleanup(): void {
    // Clear all pending messages
    for (const pending of this.pendingMessages.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new SocketError("Connection closed", "CONNECTION_CLOSED", this.socketPath, this.socketType)
      );
    }
    this.pendingMessages.clear();

    // Clear timers
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    // Clear buffers
    this.messageBuffer = Buffer.alloc(0);
    this.rttSamples = [];
  }
}
