/**
 * Connection pooling system for managing multiple concurrent socket connections.
 *
 * This module provides efficient connection pooling to improve performance
 * and resource utilization when communicating with Hyprland sockets.
 *
 * Key features:
 * - Pool-based connection management with configurable limits
 * - Automatic connection lifecycle management
 * - Load balancing across available connections
 * - Health monitoring and connection replacement
 * - Resource cleanup and memory management
 * - Concurrency safety with proper locking mechanisms
 *
 * @see {@link https://hyprland.org/} - Hyprland window manager
 */

import { EventEmitter } from "node:events";
import { AtomicBoolean } from "./concurrency.js";
import { SocketConnection, type SocketConnectionConfig } from "./socket-communication.js";
import type { IPCEvent, IPCMessage, IPCRequest, IPCResponse, SocketType } from "./types.js";

// ============================================================================
// Constants and Configuration
// ============================================================================

/**
 * Default connection pool configuration.
 * These values provide optimal balance between performance and resource usage.
 */
const DEFAULT_POOL_CONFIG = {
  /** Minimum number of connections to maintain */
  minConnections: 1,
  /** Maximum number of connections allowed */
  maxConnections: 5,
  /** Maximum time a connection can be idle before cleanup (ms) */
  maxIdleTime: 60000, // 1 minute
  /** Connection acquisition timeout (ms) */
  acquisitionTimeout: 5000,
  /** Health check interval (ms) */
  healthCheckInterval: 30000,
  /** Maximum number of retries for connection operations */
  maxRetries: 3,
  /** Enable connection prewarming */
  preWarmConnections: true,
} as const;

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Connection pool configuration options.
 */
export interface SocketPoolConfig {
  /** Minimum number of connections to maintain */
  readonly minConnections?: number;
  /** Maximum number of connections allowed */
  readonly maxConnections?: number;
  /** Maximum time a connection can be idle before cleanup (ms) */
  readonly maxIdleTime?: number;
  /** Connection acquisition timeout (ms) */
  readonly acquisitionTimeout?: number;
  /** Health check interval (ms) */
  readonly healthCheckInterval?: number;
  /** Maximum number of retries for connection operations */
  readonly maxRetries?: number;
  /** Enable connection prewarming */
  readonly preWarmConnections?: boolean;
  /** Socket connection configuration */
  readonly socketConfig?: SocketConnectionConfig;
}

/**
 * Pool connection wrapper with metadata.
 * Tracks connection usage and state for pool management.
 */
interface PooledConnection {
  readonly id: string;
  readonly connection: SocketConnection;
  readonly createdAt: number;
  lastUsed: number;
  inUse: boolean;
  useCount: number;
  healthy: boolean;
}

/**
 * Connection acquisition request.
 * Manages pending connection requests when pool is at capacity.
 */
interface ConnectionRequest {
  readonly id: string;
  readonly resolve: (connection: PooledConnection) => void;
  readonly reject: (error: Error) => void;
  readonly timestamp: number;
  readonly timeout: NodeJS.Timeout;
}

/**
 * Pool statistics for monitoring and diagnostics.
 */
export interface PoolStats {
  /** Total number of connections in pool */
  readonly totalConnections: number;
  /** Number of active connections */
  readonly activeConnections: number;
  /** Number of idle connections */
  readonly idleConnections: number;
  /** Number of pending connection requests */
  readonly pendingRequests: number;
  /** Pool hit rate (successful acquisitions / total requests) */
  readonly hitRate: number;
  /** Average connection age in milliseconds */
  readonly averageConnectionAge: number;
  /** Total connections created since pool start */
  readonly totalConnectionsCreated: number;
  /** Total connections destroyed since pool start */
  readonly totalConnectionsDestroyed: number;
  /** Pool utilization percentage */
  readonly utilization: number;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base pool error class.
 */
export class PoolError extends Error {
  public readonly code: string;
  public readonly poolId?: string;

  constructor(message: string, code: string, poolId?: string) {
    super(message);
    this.name = "PoolError";
    this.code = code;
    if (poolId !== undefined) {
      this.poolId = poolId;
    }
  }
}

/**
 * Pool exhaustion error.
 * Thrown when no connections are available and pool is at capacity.
 */
export class PoolExhaustedError extends PoolError {
  constructor(maxConnections: number, timeout: number) {
    super(
      `Pool exhausted: no connections available from ${maxConnections} max connections after ${timeout}ms`,
      "POOL_EXHAUSTED"
    );
    this.name = "PoolExhaustedError";
  }
}

/**
 * Connection acquisition timeout error.
 */
export class AcquisitionTimeoutError extends PoolError {
  constructor(timeout: number) {
    super(`Connection acquisition timeout after ${timeout}ms`, "ACQUISITION_TIMEOUT");
    this.name = "AcquisitionTimeoutError";
  }
}

// ============================================================================
// Socket Connection Pool Class
// ============================================================================

/**
 * High-performance connection pool for UNIX socket connections.
 *
 * Manages a pool of socket connections to optimize resource usage
 * and improve application performance through connection reuse.
 */
export class SocketConnectionPool extends EventEmitter {
  private readonly config: Required<SocketPoolConfig>;
  private readonly connections = new Map<string, PooledConnection>();
  private readonly pendingRequests = new Map<string, ConnectionRequest>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private stats = {
    totalConnectionsCreated: 0,
    totalConnectionsDestroyed: 0,
    totalRequests: 0,
    successfulAcquisitions: 0,
  };

  // Concurrency safety primitives
  private readonly isClosing = new AtomicBoolean(false);

  private readonly socketPath: string;
  private readonly socketType: SocketType;

  /**
   * Creates a new socket connection pool.
   *
   * @param socketPath - Path to the UNIX socket
   * @param socketType - Type of socket (command or event)
   * @param config - Pool configuration options
   */
  constructor(socketPath: string, socketType: SocketType, config: SocketPoolConfig = {}) {
    super();

    this.socketPath = socketPath;
    this.socketType = socketType;

    this.config = {
      minConnections: config.minConnections ?? DEFAULT_POOL_CONFIG.minConnections,
      maxConnections: config.maxConnections ?? DEFAULT_POOL_CONFIG.maxConnections,
      maxIdleTime: config.maxIdleTime ?? DEFAULT_POOL_CONFIG.maxIdleTime,
      acquisitionTimeout: config.acquisitionTimeout ?? DEFAULT_POOL_CONFIG.acquisitionTimeout,
      healthCheckInterval: config.healthCheckInterval ?? DEFAULT_POOL_CONFIG.healthCheckInterval,
      maxRetries: config.maxRetries ?? DEFAULT_POOL_CONFIG.maxRetries,
      preWarmConnections: config.preWarmConnections ?? DEFAULT_POOL_CONFIG.preWarmConnections,
      socketConfig: config.socketConfig ?? {},
    };

    // Validate configuration
    if (this.config.minConnections > this.config.maxConnections) {
      throw new PoolError("minConnections cannot be greater than maxConnections", "INVALID_CONFIG");
    }

    this.initialize();
  }

  /**
   * Initializes the connection pool.
   * Sets up health checking and pre-warms connections if configured.
   */
  private async initialize(): Promise<void> {
    // Start health checking
    this.startHealthCheck();

    // Pre-warm connections if enabled
    if (this.config.preWarmConnections) {
      try {
        await this.ensureMinConnections();
      } catch (error) {
        this.emit(
          "error",
          new PoolError(
            `Failed to pre-warm connections: ${error instanceof Error ? error.message : String(error)}`,
            "PREWARM_FAILED"
          )
        );
      }
    }
  }

  /**
   * Acquires a connection from the pool.
   * Returns an existing idle connection or creates a new one if available.
   *
   * @returns Promise that resolves with a pooled connection
   * @throws {PoolExhaustedError} When pool is at capacity and no connections available
   * @throws {AcquisitionTimeoutError} When acquisition times out
   */
  async acquire(): Promise<PooledConnection> {
    if (await this.isClosing.get()) {
      throw new PoolError("Cannot acquire connection: pool is closing", "POOL_CLOSING");
    }

    this.stats.totalRequests++;

    // Try to get an idle connection first
    const idleConnection = this.getIdleConnection();
    if (idleConnection) {
      this.markConnectionInUse(idleConnection);
      this.stats.successfulAcquisitions++;
      return idleConnection;
    }

    // Create new connection if under limit
    if (this.connections.size < this.config.maxConnections) {
      try {
        const newConnection = await this.createConnection();
        this.markConnectionInUse(newConnection);
        this.stats.successfulAcquisitions++;
        return newConnection;
      } catch (error) {
        throw new PoolError(
          `Failed to create new connection: ${error instanceof Error ? error.message : String(error)}`,
          "CONNECTION_CREATION_FAILED"
        );
      }
    }

    // Wait for a connection to become available
    return this.waitForConnection();
  }

  /**
   * Releases a connection back to the pool.
   * Makes the connection available for reuse by other operations.
   *
   * @param connection - The pooled connection to release
   */
  release(connection: PooledConnection): void {
    const pooledConnection = this.connections.get(connection.id);
    if (!pooledConnection) {
      // Connection not in pool, destroy it
      connection.connection.close().catch(() => {
        // Ignore errors during cleanup
      });
      return;
    }

    this.markConnectionIdle(pooledConnection);
    this.processWaitingRequests();
  }

  /**
   * Executes a function with an acquired connection and automatically releases it.
   * Provides a convenient way to use pooled connections with automatic cleanup.
   *
   * @param fn - Function to execute with the connection
   * @returns Promise that resolves with the function result
   */
  async withConnection<T>(fn: (connection: SocketConnection) => Promise<T>): Promise<T> {
    const pooledConnection = await this.acquire();

    try {
      return await fn(pooledConnection.connection);
    } finally {
      this.release(pooledConnection);
    }
  }

  /**
   * Sends a message using a pooled connection.
   * Automatically handles connection acquisition and release.
   *
   * @param message - Message to send
   * @returns Promise that resolves when message is sent
   */
  async sendMessage(message: IPCMessage): Promise<void> {
    return this.withConnection(async (connection) => {
      await connection.sendMessage(message);
    });
  }

  /**
   * Sends a request using a pooled connection.
   * Automatically handles connection acquisition and release.
   *
   * @param request - Request to send
   * @returns Promise that resolves with the response
   */
  async sendRequest(request: IPCRequest): Promise<IPCResponse> {
    return this.withConnection(async (connection) => {
      return connection.sendRequest(request);
    });
  }

  /**
   * Gets current pool statistics.
   *
   * @returns Current pool statistics
   */
  getStats(): PoolStats {
    const now = Date.now();
    const totalConnections = this.connections.size;
    const activeConnections = Array.from(this.connections.values()).filter((c) => c.inUse).length;
    const idleConnections = totalConnections - activeConnections;

    const hitRate =
      this.stats.totalRequests > 0
        ? this.stats.successfulAcquisitions / this.stats.totalRequests
        : 0;

    const averageConnectionAge =
      totalConnections > 0
        ? Array.from(this.connections.values()).reduce(
            (sum, conn) => sum + (now - conn.createdAt),
            0
          ) / totalConnections
        : 0;

    const utilization =
      this.config.maxConnections > 0 ? (activeConnections / this.config.maxConnections) * 100 : 0;

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      pendingRequests: this.pendingRequests.size,
      hitRate,
      averageConnectionAge,
      totalConnectionsCreated: this.stats.totalConnectionsCreated,
      totalConnectionsDestroyed: this.stats.totalConnectionsDestroyed,
      utilization,
    };
  }

  /**
   * Closes the connection pool and all its connections.
   * Waits for all connections to close gracefully.
   *
   * @param force - Whether to force close connections immediately
   * @returns Promise that resolves when pool is closed
   */
  async close(force = false): Promise<void> {
    if (await this.isClosing.get()) {
      return;
    }

    await this.isClosing.set(true);

    // Stop health checking
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Reject all pending requests
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timeout);
      request.reject(new PoolError("Pool is closing", "POOL_CLOSING"));
    }
    this.pendingRequests.clear();

    // Close all connections
    const closePromises = Array.from(this.connections.values()).map(async (pooledConnection) => {
      try {
        if (force) {
          // Force close immediately
          pooledConnection.connection.close();
        } else {
          // Wait for graceful close
          await pooledConnection.connection.close();
        }
      } catch {
        // Ignore errors during cleanup
      }
    });

    await Promise.allSettled(closePromises);
    this.connections.clear();
    this.emit("closed");
  }

  // ============================================================================
  // Private Implementation Methods
  // ============================================================================

  /**
   * Gets an idle connection from the pool.
   */
  private getIdleConnection(): PooledConnection | null {
    for (const connection of this.connections.values()) {
      if (!connection.inUse && connection.healthy && connection.connection.isConnected()) {
        return connection;
      }
    }
    return null;
  }

  /**
   * Creates a new pooled connection.
   */
  private async createConnection(): Promise<PooledConnection> {
    const connectionId = this.generateConnectionId();
    const socketConnection = new SocketConnection(
      this.socketPath,
      this.socketType,
      this.config.socketConfig
    );

    // Set up connection event handlers
    socketConnection.on("error", (error) => {
      this.handleConnectionError(connectionId, error);
    });

    socketConnection.on("disconnected", () => {
      this.handleConnectionDisconnected(connectionId);
    });

    socketConnection.on("event", (event: IPCEvent) => {
      this.emit("event", event);
    });

    // Connect the socket
    await socketConnection.connect();

    const pooledConnection: PooledConnection = {
      id: connectionId,
      connection: socketConnection,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      inUse: false,
      useCount: 0,
      healthy: true,
    };

    this.connections.set(connectionId, pooledConnection);
    this.stats.totalConnectionsCreated++;
    this.emit("connectionCreated", pooledConnection);

    return pooledConnection;
  }

  /**
   * Marks a connection as in use.
   */
  private markConnectionInUse(connection: PooledConnection): void {
    connection.inUse = true;
    connection.lastUsed = Date.now();
    connection.useCount++;
  }

  /**
   * Marks a connection as idle.
   */
  private markConnectionIdle(connection: PooledConnection): void {
    connection.inUse = false;
    connection.lastUsed = Date.now();
  }

  /**
   * Waits for a connection to become available.
   */
  private async waitForConnection(): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new AcquisitionTimeoutError(this.config.acquisitionTimeout));
      }, this.config.acquisitionTimeout);

      this.pendingRequests.set(requestId, {
        id: requestId,
        resolve,
        reject,
        timestamp: Date.now(),
        timeout,
      });
    });
  }

  /**
   * Processes waiting connection requests.
   */
  private processWaitingRequests(): void {
    if (this.pendingRequests.size === 0) {
      return;
    }

    const idleConnection = this.getIdleConnection();
    if (!idleConnection) {
      return;
    }

    // Get the oldest waiting request
    const oldestRequest = Array.from(this.pendingRequests.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    )[0];

    if (oldestRequest) {
      this.pendingRequests.delete(oldestRequest.id);
      clearTimeout(oldestRequest.timeout);
      this.markConnectionInUse(idleConnection);
      this.stats.successfulAcquisitions++;
      oldestRequest.resolve(idleConnection);
    }
  }

  /**
   * Ensures minimum number of connections are available.
   */
  private async ensureMinConnections(): Promise<void> {
    const currentConnections = this.connections.size;
    const neededConnections = this.config.minConnections - currentConnections;

    if (neededConnections <= 0) {
      return;
    }

    const createPromises = Array(neededConnections)
      .fill(null)
      .map(() =>
        this.createConnection().catch((error) => {
          // Log error but don't fail the entire operation
          this.emit(
            "error",
            new PoolError(
              `Failed to create minimum connection: ${error instanceof Error ? error.message : String(error)}`,
              "MIN_CONNECTION_FAILED"
            )
          );
          return null;
        })
      );

    await Promise.allSettled(createPromises);
  }

  /**
   * Starts the health check interval.
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Performs health check on all connections.
   */
  private performHealthCheck(): void {
    const now = Date.now();
    const connectionsToRemove: string[] = [];

    for (const [id, connection] of this.connections.entries()) {
      const age = now - connection.lastUsed;
      const isIdle = !connection.inUse;
      const isStale = age > this.config.maxIdleTime;
      const isUnhealthy = !connection.healthy || !connection.connection.isConnected();

      // Remove stale idle connections or unhealthy connections
      if ((isIdle && isStale) || isUnhealthy) {
        connectionsToRemove.push(id);
      }
    }

    // Remove unhealthy connections
    for (const id of connectionsToRemove) {
      this.removeConnection(id);
    }

    // Ensure minimum connections
    if (this.connections.size < this.config.minConnections) {
      this.ensureMinConnections().catch((error) => {
        this.emit(
          "error",
          new PoolError(
            `Health check failed to ensure minimum connections: ${error instanceof Error ? error.message : String(error)}`,
            "HEALTH_CHECK_FAILED"
          )
        );
      });
    }
  }

  /**
   * Handles connection errors.
   */
  private handleConnectionError(connectionId: string, error: Error): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.healthy = false;
      this.emit("connectionError", connectionId, error);
    }
  }

  /**
   * Handles connection disconnection.
   */
  private handleConnectionDisconnected(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.healthy = false;
      this.emit("connectionDisconnected", connectionId);
    }
  }

  /**
   * Removes a connection from the pool.
   */
  private removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    this.connections.delete(connectionId);
    this.stats.totalConnectionsDestroyed++;

    // Close the connection
    connection.connection.close().catch(() => {
      // Ignore errors during cleanup
    });

    this.emit("connectionDestroyed", connectionId);
  }

  /**
   * Generates a unique connection ID.
   */
  private generateConnectionId(): string {
    return `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique request ID.
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
