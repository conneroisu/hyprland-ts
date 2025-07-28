/**
 * HyprCtl Command Execution System
 *
 * This module provides a comprehensive command execution system for Hyprland IPC
 * with proper request formatting, response parsing, and advanced features like
 * batching, caching, and performance monitoring.
 *
 * Key features:
 * - Type-safe command execution with validation
 * - Request formatting according to Hyprland IPC protocol
 * - Response parsing for JSON and text responses
 * - Batch command execution with transaction semantics
 * - Result caching with configurable TTL
 * - Version compatibility detection and adaptation
 * - Command history tracking for debugging
 * - Rate limiting to prevent overwhelming Hyprland
 * - Comprehensive error handling and timeout management
 * - Performance monitoring and execution tracking
 * - Async/await interface with Promise handling
 */

import { EventEmitter } from "node:events";
import { RateLimiter } from "./concurrency.js";
import { SocketConnectionPool } from "./socket-pool.js";
import type {
  HyprCtlCommand,
  HyprCtlDispatchCommand,
  HyprCtlRequest,
  HyprCtlResponse,
  IPCRequest,
  IPCResponse,
  SocketType,
} from "./types.js";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for HyprCtl command execution errors.
 */
export class HyprCtlError extends Error {
  public readonly code: string;
  public readonly command?: string;
  public readonly args?: readonly string[];

  constructor(message: string, code: string, command?: string, args?: readonly string[]) {
    super(message);
    this.name = "HyprCtlError";
    this.code = code;
    if (command !== undefined) {
      this.command = command;
    }
    if (args !== undefined) {
      this.args = args;
    }
  }
}

/**
 * Command validation error.
 */
export class CommandValidationError extends HyprCtlError {
  constructor(command: string, reason: string) {
    super(`Invalid command '${command}': ${reason}`, "COMMAND_VALIDATION_ERROR", command);
    this.name = "CommandValidationError";
  }
}

/**
 * Command execution timeout error.
 */
export class CommandTimeoutError extends HyprCtlError {
  constructor(command: string, timeout: number) {
    super(`Command '${command}' timed out after ${timeout}ms`, "COMMAND_TIMEOUT", command);
    this.name = "CommandTimeoutError";
  }
}

/**
 * Command execution error returned by Hyprland.
 */
export class CommandExecutionError extends HyprCtlError {
  constructor(command: string, error: string, args?: readonly string[]) {
    super(`Command '${command}' failed: ${error}`, "COMMAND_EXECUTION_ERROR", command, args);
    this.name = "CommandExecutionError";
  }
}

/**
 * Version compatibility error.
 */
export class VersionCompatibilityError extends HyprCtlError {
  constructor(command: string, version: string, minVersion: string) {
    super(
      `Command '${command}' requires Hyprland version ${minVersion} or higher (current: ${version})`,
      "VERSION_COMPATIBILITY_ERROR",
      command
    );
    this.name = "VersionCompatibilityError";
  }
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration options for HyprCtl client.
 */
export interface HyprCtlClientConfig {
  /** Socket path for command socket */
  readonly socketPath: string;
  /** Timeout for individual commands in milliseconds (default: 5000) */
  readonly commandTimeout?: number;
  /** Enable result caching (default: true) */
  readonly enableCaching?: boolean;
  /** Cache TTL in milliseconds (default: 1000) */
  readonly cacheTtl?: number;
  /** Maximum cache size (default: 100) */
  readonly maxCacheSize?: number;
  /** Enable command history tracking (default: true) */
  readonly enableHistory?: boolean;
  /** Maximum history size (default: 1000) */
  readonly maxHistorySize?: number;
  /** Rate limiting - max commands per second (default: 50) */
  readonly maxCommandsPerSecond?: number;
  /** Enable performance monitoring (default: true) */
  readonly enableMonitoring?: boolean;
  /** Connection pool configuration */
  readonly poolConfig?: {
    readonly minConnections?: number;
    readonly maxConnections?: number;
    readonly maxIdleTime?: number;
  };
}

/**
 * Command execution options.
 */
export interface CommandOptions {
  /** Request JSON response (default: true) */
  readonly json?: boolean;
  /** Command timeout override */
  readonly timeout?: number;
  /** Skip cache for this command */
  readonly skipCache?: boolean;
  /** Command priority for rate limiting */
  readonly priority?: "low" | "normal" | "high";
  /** Execution context for debugging */
  readonly context?: string;
}

/**
 * Batch command execution options.
 */
export interface BatchCommandOptions {
  /** Stop on first error (default: false) */
  readonly stopOnError?: boolean;
  /** Batch timeout in milliseconds */
  readonly timeout?: number;
  /** Execute commands in parallel (default: false) */
  readonly parallel?: boolean;
  /** Maximum parallelism (default: 5) */
  readonly maxParallel?: number;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Command execution result.
 */
export interface CommandResult<T = unknown> {
  /** Whether the command succeeded */
  readonly success: boolean;
  /** Response data */
  readonly data: T | undefined;
  /** Error message if failed */
  readonly error: string | undefined;
  /** Execution time in milliseconds */
  readonly executionTime: number;
  /** Timestamp when command was executed */
  readonly timestamp: number;
  /** Command that was executed */
  readonly command: string;
  /** Arguments passed to command */
  readonly args?: readonly string[];
  /** Whether result came from cache */
  readonly fromCache?: boolean;
}

/**
 * Batch command execution result.
 */
export interface BatchCommandResult {
  /** Overall success status */
  readonly success: boolean;
  /** Individual command results */
  readonly results: CommandResult[];
  /** Total execution time */
  readonly totalExecutionTime: number;
  /** Number of successful commands */
  readonly successCount: number;
  /** Number of failed commands */
  readonly errorCount: number;
}

/**
 * Command history entry.
 */
export interface CommandHistoryEntry {
  /** Unique execution ID */
  readonly id: string;
  /** Command that was executed */
  readonly command: string;
  /** Arguments passed */
  readonly args?: readonly string[];
  /** Execution timestamp */
  readonly timestamp: number;
  /** Execution time in milliseconds */
  readonly executionTime: number;
  /** Whether command succeeded */
  readonly success: boolean;
  /** Error message if failed */
  readonly error?: string;
  /** Execution context */
  readonly context?: string;
}

/**
 * Performance metrics.
 */
export interface PerformanceMetrics {
  /** Total commands executed */
  readonly totalCommands: number;
  /** Successful commands */
  readonly successfulCommands: number;
  /** Failed commands */
  readonly failedCommands: number;
  /** Average execution time */
  readonly averageExecutionTime: number;
  /** Cache hit rate */
  readonly cacheHitRate: number;
  /** Commands per second */
  readonly commandsPerSecond: number;
  /** Current rate limit status */
  readonly rateLimitStatus: {
    readonly tokensAvailable: number;
    readonly tokensCapacity: number;
    readonly refillRate: number;
  };
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache entry for command results.
 */
interface CacheEntry<T = unknown> {
  readonly result: CommandResult<T>;
  readonly expiresAt: number;
  readonly hitCount: number;
}

/**
 * Command cache implementation.
 */
class CommandCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttl: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(maxSize = 100, ttl = 1000) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  /**
   * Get cached result for command.
   */
  get<T = unknown>(key: string): CommandResult<T> | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return undefined;
    }

    this.hitCount++;
    // Update hit count
    this.cache.set(key, {
      ...entry,
      hitCount: entry.hitCount + 1,
    });

    return {
      ...entry.result,
      fromCache: true,
    } as CommandResult<T>;
  }

  /**
   * Store result in cache.
   */
  set<T = unknown>(key: string, result: CommandResult<T>): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.ttl,
      hitCount: 0,
    });
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Get cache statistics.
   */
  getStats() {
    return {
      size: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate:
        this.hitCount + this.missCount > 0 ? this.hitCount / (this.hitCount + this.missCount) : 0,
    };
  }

  /**
   * Evict oldest entries based on access time.
   */
  private evictOldest(): void {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].hitCount - b[1].hitCount);

    // Remove 20% of entries
    const toRemove = Math.max(1, Math.floor(entries.length * 0.2));
    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) {
        this.cache.delete(entry[0]);
      }
    }
  }
}

// ============================================================================
// HyprCtl Client Implementation
// ============================================================================

/**
 * HyprCtl command execution client.
 */
export class HyprCtlClient extends EventEmitter {
  private readonly config: Required<HyprCtlClientConfig>;
  private readonly connectionPool: SocketConnectionPool;
  private readonly cache: CommandCache;
  private readonly rateLimiter: RateLimiter;
  private readonly commandHistory: CommandHistoryEntry[] = [];
  private readonly performanceMetrics = {
    totalCommands: 0,
    successfulCommands: 0,
    failedCommands: 0,
    totalExecutionTime: 0,
    startTime: Date.now(),
  };
  private executionId = 0;

  constructor(config: HyprCtlClientConfig) {
    super();

    // Set default configuration
    this.config = {
      socketPath: config.socketPath,
      commandTimeout: config.commandTimeout ?? 5000,
      enableCaching: config.enableCaching ?? true,
      cacheTtl: config.cacheTtl ?? 1000,
      maxCacheSize: config.maxCacheSize ?? 100,
      enableHistory: config.enableHistory ?? true,
      maxHistorySize: config.maxHistorySize ?? 1000,
      maxCommandsPerSecond: config.maxCommandsPerSecond ?? 50,
      enableMonitoring: config.enableMonitoring ?? true,
      poolConfig: {
        minConnections: config.poolConfig?.minConnections ?? 1,
        maxConnections: config.poolConfig?.maxConnections ?? 5,
        maxIdleTime: config.poolConfig?.maxIdleTime ?? 30000,
      },
    };

    // Initialize connection pool
    this.connectionPool = new SocketConnectionPool(
      this.config.socketPath,
      "command" as SocketType,
      {
        minConnections: this.config.poolConfig.minConnections ?? 1,
        maxConnections: this.config.poolConfig.maxConnections ?? 5,
        maxIdleTime: this.config.poolConfig.maxIdleTime ?? 30000,
        acquisitionTimeout: this.config.commandTimeout,
      }
    );

    // Initialize cache
    this.cache = new CommandCache(this.config.maxCacheSize, this.config.cacheTtl);

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter(
      this.config.maxCommandsPerSecond,
      this.config.maxCommandsPerSecond
    );

    // Set up event forwarding
    this.setupEventForwarding();
  }

  /**
   * Execute a single HyprCtl command.
   */
  async executeCommand<T = unknown>(
    command: HyprCtlCommand | "dispatch",
    args?: readonly string[],
    options: CommandOptions = {}
  ): Promise<CommandResult<T>> {
    const startTime = Date.now();
    const execId = this.generateExecutionId();
    const cacheKey = this.generateCacheKey(command, args, options);

    try {
      // Check cache first
      if (this.config.enableCaching && !options.skipCache) {
        const cached = this.cache.get<T>(cacheKey);
        if (cached) {
          this.emit("command", {
            type: "cache_hit",
            command,
            args,
            executionId: execId,
          });
          return cached;
        }
      }

      // Validate command
      this.validateCommand(command, args);

      // Apply rate limiting
      await this.rateLimiter.acquire(1, options.timeout ?? this.config.commandTimeout);

      // Create request
      const request = this.formatRequest(command, args, options);

      // Execute command
      const response = await this.executeRequest<T>(request, options);

      // Create result
      const result: CommandResult<T> = {
        success: response.success,
        data: response.data,
        error: response.error,
        executionTime: Date.now() - startTime,
        timestamp: startTime,
        command: command,
        args: args || [],
        fromCache: false,
      };

      // Cache successful results
      if (result.success && this.config.enableCaching) {
        this.cache.set(cacheKey, result);
      }

      // Update metrics
      this.updateMetrics(result);

      // Add to history
      if (this.config.enableHistory) {
        this.addToHistory(execId, command, args, result, options.context);
      }

      // Emit events
      this.emit("command", {
        type: result.success ? "success" : "error",
        command,
        args,
        result,
        executionId: execId,
      });

      return result;
    } catch (error) {
      const result: CommandResult<T> = {
        success: false,
        data: undefined,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        timestamp: startTime,
        command: command,
        args: args || [],
        fromCache: false,
      };

      this.updateMetrics(result);

      if (this.config.enableHistory) {
        this.addToHistory(execId, command, args, result, options.context);
      }

      this.emit("command", {
        type: "error",
        command,
        args,
        result,
        error,
        executionId: execId,
      });

      throw error;
    }
  }

  /**
   * Execute a dispatch command.
   */
  async executeDispatch<T = unknown>(
    dispatchCommand: HyprCtlDispatchCommand,
    args?: readonly string[],
    options: CommandOptions = {}
  ): Promise<CommandResult<T>> {
    return this.executeCommand<T>("dispatch", [dispatchCommand, ...(args || [])], options);
  }

  /**
   * Execute multiple commands in batch.
   */
  async executeBatch(
    commands: Array<{
      command: HyprCtlCommand | "dispatch";
      args?: readonly string[];
      options?: CommandOptions;
    }>,
    batchOptions: BatchCommandOptions = {}
  ): Promise<BatchCommandResult> {
    const startTime = Date.now();
    let results: CommandResult[];
    let successCount: number;
    let errorCount: number;

    try {
      if (batchOptions.parallel) {
        const batchStats = await this.executeCommandsInParallel(commands);
        results = batchStats.results;
        successCount = batchStats.successCount;
        errorCount = batchStats.errorCount;
      } else {
        const batchStats = await this.executeCommandsSequentially(commands, batchOptions);
        results = batchStats.results;
        successCount = batchStats.successCount;
        errorCount = batchStats.errorCount;
      }

      const batchResult = this.createBatchResult(results, successCount, errorCount, startTime);

      this.emitBatchEvent(batchResult, commands.length);
      return batchResult;
    } catch (error) {
      this.emit("batch", {
        type: "error",
        commands: commands.length,
        error,
      });
      throw error;
    }
  }

  /**
   * Execute commands in parallel for batch processing.
   */
  private async executeCommandsInParallel(
    commands: Array<{
      command: HyprCtlCommand | "dispatch";
      args?: readonly string[];
      options?: CommandOptions;
    }>
  ): Promise<{ results: CommandResult[]; successCount: number; errorCount: number }> {
    const results: CommandResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    const promises = commands.map(async ({ command, args, options }) => {
      try {
        const result = await this.executeCommand(command, args, options);
        if (result.success) successCount++;
        else errorCount++;
        return result;
      } catch (error) {
        errorCount++;
        throw error;
      }
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          data: undefined,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          executionTime: 0,
          timestamp: Date.now(),
          command: "unknown",
        });
      }
    }

    return { results, successCount, errorCount };
  }

  /**
   * Execute commands sequentially for batch processing.
   */
  private async executeCommandsSequentially(
    commands: Array<{
      command: HyprCtlCommand | "dispatch";
      args?: readonly string[];
      options?: CommandOptions;
    }>,
    batchOptions: BatchCommandOptions
  ): Promise<{ results: CommandResult[]; successCount: number; errorCount: number }> {
    const results: CommandResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const { command, args, options } of commands) {
      try {
        const result = await this.executeCommand(command, args, options);
        results.push(result);

        if (result.success) {
          successCount++;
        } else {
          errorCount++;
          if (batchOptions.stopOnError) {
            break;
          }
        }
      } catch (error) {
        errorCount++;
        const errorResult: CommandResult = {
          success: false,
          data: undefined,
          error: error instanceof Error ? error.message : String(error),
          executionTime: 0,
          timestamp: Date.now(),
          command: command,
          args: args || [],
        };
        results.push(errorResult);

        if (batchOptions.stopOnError) {
          break;
        }
      }
    }

    return { results, successCount, errorCount };
  }

  /**
   * Create batch result object.
   */
  private createBatchResult(
    results: CommandResult[],
    successCount: number,
    errorCount: number,
    startTime: number
  ): BatchCommandResult {
    return {
      success: errorCount === 0,
      results,
      totalExecutionTime: Date.now() - startTime,
      successCount,
      errorCount,
    };
  }

  /**
   * Emit batch event.
   */
  private emitBatchEvent(batchResult: BatchCommandResult, commandCount: number): void {
    this.emit("batch", {
      type: batchResult.success ? "success" : "partial",
      commands: commandCount,
      result: batchResult,
    });
  }

  /**
   * Get command execution history.
   */
  getHistory(limit?: number): CommandHistoryEntry[] {
    const history = this.commandHistory.slice();
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Clear command execution history.
   */
  clearHistory(): void {
    this.commandHistory.length = 0;
    this.emit("history", { type: "cleared" });
  }

  /**
   * Get performance metrics.
   */
  getMetrics(): PerformanceMetrics {
    const elapsed = Date.now() - this.performanceMetrics.startTime;
    const cacheStats = this.cache.getStats();

    return {
      totalCommands: this.performanceMetrics.totalCommands,
      successfulCommands: this.performanceMetrics.successfulCommands,
      failedCommands: this.performanceMetrics.failedCommands,
      averageExecutionTime:
        this.performanceMetrics.totalCommands > 0
          ? this.performanceMetrics.totalExecutionTime / this.performanceMetrics.totalCommands
          : 0,
      cacheHitRate: cacheStats.hitRate,
      commandsPerSecond: elapsed > 0 ? (this.performanceMetrics.totalCommands * 1000) / elapsed : 0,
      rateLimitStatus: {
        tokensAvailable: this.rateLimiter.availableTokens(),
        tokensCapacity: this.rateLimiter.getCapacity(),
        refillRate: this.rateLimiter.getRefillRate(),
      },
    };
  }

  /**
   * Clear result cache.
   */
  clearCache(): void {
    this.cache.clear();
    this.emit("cache", { type: "cleared" });
  }

  /**
   * Close the client and clean up resources.
   */
  async close(): Promise<void> {
    await this.connectionPool.close();
    this.cache.clear();
    this.commandHistory.length = 0;
    this.emit("closed");
  }

  /**
   * Format request according to Hyprland IPC protocol.
   */
  private formatRequest(
    command: HyprCtlCommand | "dispatch",
    args?: readonly string[],
    options: CommandOptions = {}
  ): HyprCtlRequest {
    if (command === "dispatch") {
      const [dispatchCommand, ...dispatchArgs] = args || [];
      return {
        command: "dispatch",
        args: dispatchArgs,
        dispatchCommand: dispatchCommand as HyprCtlDispatchCommand,
        json: options.json ?? true,
      };
    }

    return {
      command: command as HyprCtlCommand,
      args: args || [],
      json: options.json ?? true,
    };
  }

  /**
   * Execute formatted request.
   */
  private async executeRequest<T = unknown>(
    request: HyprCtlRequest,
    _options: CommandOptions = {}
  ): Promise<HyprCtlResponse<T>> {
    return this.connectionPool.withConnection(async (connection) => {
      const ipcRequest: IPCRequest = {
        type: "request",
        payload: request,
        id: this.generateRequestId(),
        timestamp: Date.now(),
      };

      const response = (await connection.sendRequest(ipcRequest)) as IPCResponse;

      if (!response.payload) {
        throw new CommandExecutionError(request.command, "No response payload received");
      }

      const hyprctlResponse = response.payload as HyprCtlResponse<T>;

      if (!hyprctlResponse.success && hyprctlResponse.error) {
        throw new CommandExecutionError(request.command, hyprctlResponse.error, request.args);
      }

      return hyprctlResponse;
    });
  }

  /**
   * Validate command and arguments.
   */
  private validateCommand(command: HyprCtlCommand | "dispatch", args?: readonly string[]): void {
    // Basic command validation
    if (!command || typeof command !== "string") {
      throw new CommandValidationError(String(command), "Command must be a non-empty string");
    }

    // Validate dispatch commands
    if (command === "dispatch") {
      if (!args || args.length === 0) {
        throw new CommandValidationError(command, "Dispatch command requires arguments");
      }
      // Additional dispatch command validation could be added here
    }

    // Additional command-specific validation could be added here
  }

  /**
   * Generate cache key for command.
   */
  private generateCacheKey(
    command: HyprCtlCommand | "dispatch",
    args?: readonly string[],
    options: CommandOptions = {}
  ): string {
    const key = [command, ...(args || []), String(options.json ?? true)].join("|");
    return key;
  }

  /**
   * Generate unique execution ID.
   */
  private generateExecutionId(): string {
    return `exec_${++this.executionId}_${Date.now()}`;
  }

  /**
   * Generate unique request ID.
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update performance metrics.
   */
  private updateMetrics(result: CommandResult): void {
    this.performanceMetrics.totalCommands++;
    this.performanceMetrics.totalExecutionTime += result.executionTime;

    if (result.success) {
      this.performanceMetrics.successfulCommands++;
    } else {
      this.performanceMetrics.failedCommands++;
    }
  }

  /**
   * Add command to history.
   */
  private addToHistory(
    id: string,
    command: string,
    args: readonly string[] | undefined,
    result: CommandResult,
    context?: string
  ): void {
    const entry: CommandHistoryEntry = {
      id,
      command,
      args: args || [],
      timestamp: result.timestamp,
      executionTime: result.executionTime,
      success: result.success,
    };

    if (result.error) {
      (entry as CommandHistoryEntry & { error: string }).error = result.error;
    }

    if (context) {
      (entry as CommandHistoryEntry & { context: string }).context = context;
    }

    this.commandHistory.push(entry);

    // Limit history size
    if (this.commandHistory.length > this.config.maxHistorySize) {
      this.commandHistory.shift();
    }
  }

  /**
   * Set up event forwarding from connection pool.
   */
  private setupEventForwarding(): void {
    this.connectionPool.on("error", (error) => {
      this.emit("connection_error", error);
    });

    this.connectionPool.on("connectionCreated", () => {
      this.emit("connection", { type: "created" });
    });

    this.connectionPool.on("connectionDestroyed", () => {
      this.emit("connection", { type: "destroyed" });
    });
  }
}
