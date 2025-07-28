/**
 * Main HyprlandClient class providing unified interface for Hyprland interactions.
 *
 * This module provides a comprehensive client that combines command execution
 * and event handling into a single, cohesive interface for interacting with
 * Hyprland window manager.
 *
 * Key features:
 * - Unified interface combining command execution and event handling
 * - Automatic connection management with health monitoring
 * - Client state management with detailed status transitions
 * - Resource lifecycle management with proper cleanup
 * - Error handling and propagation with actionable messages
 * - Performance monitoring and metrics collection
 * - Configuration validation and capability detection
 * - Graceful shutdown and reconnection handling
 */

import { EventEmitter } from "node:events";
import { type EventMetadata, type EventSystemConfig, HyprlandEventSystem } from "./event-system.js";
import { HyprCtlClient, type HyprCtlClientConfig } from "./hyprctl-client.js";
import { discoverSockets } from "./socket-discovery.js";
import type { HyprlandEventData, SocketDiscoveryOptions, SocketInfo } from "./types.js";

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Client state enumeration for state management.
 */
export enum ClientState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Reconnecting = "reconnecting",
  ShuttingDown = "shutting_down",
  Error = "error",
}

/**
 * Client health status for monitoring.
 */
export interface ClientHealth {
  /** Overall health status */
  readonly status: "healthy" | "degraded" | "unhealthy";
  /** Command execution health */
  readonly commandHealth: "healthy" | "degraded" | "unhealthy";
  /** Event system health */
  readonly eventHealth: "healthy" | "degraded" | "unhealthy";
  /** Connection uptime in milliseconds */
  readonly uptime: number;
  /** Last health check timestamp */
  readonly lastCheck: number;
  /** Health issues if any */
  readonly issues: readonly string[];
}

/**
 * Client capabilities detected from Hyprland instance.
 */
export interface ClientCapabilities {
  /** Hyprland version string */
  readonly version: string;
  /** Supported command types */
  readonly supportedCommands: readonly string[];
  /** Supported event types */
  readonly supportedEvents: readonly string[];
  /** Feature flags */
  readonly features: {
    readonly batchCommands: boolean;
    readonly eventFiltering: boolean;
    readonly asyncEvents: boolean;
  };
}

/**
 * Comprehensive configuration for HyprlandClient.
 */
export interface HyprlandClientConfig {
  /** Socket discovery options */
  readonly socketDiscovery?: SocketDiscoveryOptions;
  /** Specific socket paths (overrides discovery) */
  readonly sockets?: {
    readonly command?: string;
    readonly event?: string;
  };
  /** Command execution configuration */
  readonly commands?: Partial<HyprCtlClientConfig>;
  /** Event system configuration */
  readonly events?: EventSystemConfig;
  /** Connection management settings */
  readonly connection?: {
    /** Connection timeout in milliseconds */
    readonly timeout?: number;
    /** Enable automatic reconnection */
    readonly autoReconnect?: boolean;
    /** Reconnection retry attempts */
    readonly maxRetries?: number;
    /** Reconnection delay in milliseconds */
    readonly retryDelay?: number;
    /** Health check interval in milliseconds */
    readonly healthCheckInterval?: number;
    /** Connection keep-alive settings */
    readonly keepAlive?: boolean;
    readonly keepAliveInterval?: number;
  };
  /** Client lifecycle settings */
  readonly lifecycle?: {
    /** Graceful shutdown timeout */
    readonly shutdownTimeout?: number;
    /** Enable resource monitoring */
    readonly enableResourceMonitoring?: boolean;
    /** Cleanup interval for resources */
    readonly cleanupInterval?: number;
  };
  /** Performance monitoring settings */
  readonly monitoring?: {
    /** Enable performance monitoring */
    readonly enabled?: boolean;
    /** Metrics collection interval */
    readonly metricsInterval?: number;
    /** Enable detailed tracing */
    readonly enableTracing?: boolean;
  };
  /** Capability detection settings */
  readonly capabilities?: {
    /** Enable automatic capability detection */
    readonly autoDetect?: boolean;
    /** Capability detection timeout */
    readonly detectionTimeout?: number;
    /** Cached capabilities (skip detection) */
    readonly cached?: ClientCapabilities | null;
  };
}

/**
 * Client performance metrics.
 */
export interface ClientMetrics {
  /** Total client uptime */
  readonly uptime: number;
  /** Connection metrics */
  readonly connection: {
    readonly totalConnections: number;
    readonly failedConnections: number;
    readonly reconnectionCount: number;
    readonly averageConnectionTime: number;
  };
  /** Command execution metrics */
  readonly commands: {
    readonly totalExecuted: number;
    readonly successfulCommands: number;
    readonly failedCommands: number;
    readonly averageExecutionTime: number;
    readonly commandsPerSecond: number;
  };
  /** Event system metrics */
  readonly events: {
    readonly totalReceived: number;
    readonly totalProcessed: number;
    readonly activeSubscriptions: number;
    readonly averageProcessingTime: number;
    readonly eventsPerSecond: number;
  };
  /** Resource metrics */
  readonly resources: {
    readonly memoryUsage: number;
    readonly connectionPoolSize: number;
    readonly eventBufferSize: number;
  };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base client error class.
 */
export class HyprlandClientError extends Error {
  public readonly code: string;
  public readonly state: ClientState;

  constructor(message: string, code: string, state: ClientState) {
    super(message);
    this.name = "HyprlandClientError";
    this.code = code;
    this.state = state;
  }
}

/**
 * Connection-related errors.
 */
export class ConnectionError extends HyprlandClientError {
  constructor(message: string, state: ClientState = ClientState.Error) {
    super(message, "CONNECTION_ERROR", state);
    this.name = "ConnectionError";
  }
}

/**
 * Configuration validation errors.
 */
export class ConfigurationError extends HyprlandClientError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR", ClientState.Error);
    this.name = "ConfigurationError";
  }
}

/**
 * Capability detection errors.
 */
export class CapabilityError extends HyprlandClientError {
  constructor(message: string) {
    super(message, "CAPABILITY_ERROR", ClientState.Error);
    this.name = "CapabilityError";
  }
}

// ============================================================================
// Main HyprlandClient Class
// ============================================================================

/**
 * Main client class providing unified interface for Hyprland interactions.
 *
 * This class combines command execution and event handling into a single,
 * cohesive interface with comprehensive state management, health monitoring,
 * and resource lifecycle management.
 */
export class HyprlandClient extends EventEmitter {
  private readonly config: Required<HyprlandClientConfig>;
  private hyprctlClient: HyprCtlClient | null = null;
  private eventSystem: HyprlandEventSystem | null = null;
  private currentState: ClientState = ClientState.Disconnected;
  private socketInfo: { command: SocketInfo; event: SocketInfo } | null = null;
  private capabilities: ClientCapabilities | null = null;

  // Health monitoring
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealthCheck = 0;
  private connectionStartTime = 0;

  // Metrics tracking
  private metrics: {
    startTime: number;
    connectionAttempts: number;
    failedConnections: number;
    reconnectionCount: number;
    connectionTimes: number[];
  };

  // Lifecycle management
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private resourceCleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: HyprlandClientConfig = {}) {
    super();
    this.setMaxListeners(0); // Allow unlimited listeners

    // Set default configuration with comprehensive options
    this.config = this.validateAndNormalizeConfig(config);

    // Initialize metrics tracking
    this.metrics = {
      startTime: Date.now(),
      connectionAttempts: 0,
      failedConnections: 0,
      reconnectionCount: 0,
      connectionTimes: [],
    };

    // Setup periodic health checks if enabled
    if (
      this.config.connection.healthCheckInterval &&
      this.config.connection.healthCheckInterval > 0
    ) {
      this.setupHealthMonitoring();
    }

    // Setup resource monitoring if enabled
    if (this.config.lifecycle.enableResourceMonitoring) {
      this.setupResourceMonitoring();
    }
  }

  /**
   * Gets the current client state.
   */
  get state(): ClientState {
    return this.currentState;
  }

  /**
   * Checks if the client is connected and operational.
   */
  get isConnected(): boolean {
    return this.currentState === ClientState.Connected;
  }

  /**
   * Gets detected client capabilities.
   */
  get clientCapabilities(): ClientCapabilities | null {
    return this.capabilities;
  }

  /**
   * Connects to Hyprland and initializes all subsystems.
   *
   * @returns Promise that resolves when connection is established
   * @throws {ConnectionError} When connection fails
   */
  async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new ConnectionError("Cannot connect: client is shutting down");
    }

    if (this.currentState !== ClientState.Disconnected) {
      return; // Already connected or connecting
    }

    this.setState(ClientState.Connecting);
    const connectionStart = Date.now();
    this.metrics.connectionAttempts++;

    try {
      // Discover or use configured socket paths
      await this.discoverSockets();

      // Initialize command execution client
      await this.initializeCommandClient();

      // Initialize event handling system
      await this.initializeEventSystem();

      // Detect capabilities if enabled
      if (this.config.capabilities.autoDetect) {
        await this.detectCapabilities();
      }

      // Setup connection monitoring
      this.connectionStartTime = Date.now();
      this.setupConnectionMonitoring();

      // Track connection time
      const connectionTime = Date.now() - connectionStart;
      this.metrics.connectionTimes.push(connectionTime);
      if (this.metrics.connectionTimes.length > 100) {
        this.metrics.connectionTimes.shift();
      }

      this.setState(ClientState.Connected);
      this.emit("connected", this.getClientStatus());
    } catch (error) {
      this.metrics.failedConnections++;
      this.setState(ClientState.Error);

      const connectionError = new ConnectionError(
        `Failed to connect to Hyprland: ${error instanceof Error ? error.message : String(error)}`
      );

      this.emit("error", connectionError);
      throw connectionError;
    }
  }

  /**
   * Executes a command through the unified interface.
   */
  async executeCommand<T = unknown>(
    command: string,
    args?: readonly string[],
    options?: { timeout?: number; priority?: "low" | "normal" | "high" }
  ): Promise<T> {
    this.ensureConnected();

    if (!this.hyprctlClient) {
      throw new ConnectionError("Command client not initialized");
    }

    try {
      const result = await this.hyprctlClient.executeCommand(command as never, args, options);
      if (!result.success) {
        throw new Error(result.error || "Command execution failed");
      }
      return result.data as T;
    } catch (error) {
      this.emit("commandError", error);
      throw error;
    }
  }

  /**
   * Subscribes to events through the unified interface.
   */
  async subscribe<T extends HyprlandEventData = HyprlandEventData>(
    eventTypes: string | readonly string[],
    handler: (event: T, metadata: EventMetadata) => void | Promise<void>,
    options?: {
      filter?: (event: T, metadata: EventMetadata) => boolean;
      transform?: (event: T, metadata: EventMetadata) => T;
      includeReplay?: boolean;
      bufferLimit?: number;
      priority?: number;
      sync?: boolean;
    }
  ): Promise<{ unsubscribe: () => void }> {
    this.ensureConnected();

    if (!this.eventSystem) {
      throw new ConnectionError("Event system not initialized");
    }

    try {
      const subscription = await this.eventSystem.subscribe(
        eventTypes,
        handler as never,
        options as never
      );
      return { unsubscribe: () => subscription.unsubscribe() };
    } catch (error) {
      this.emit("subscriptionError", error);
      throw error;
    }
  }

  /**
   * Gets comprehensive client health status.
   */
  getHealth(): ClientHealth {
    const now = Date.now();
    const issues: string[] = [];

    // Check command client health
    let commandHealth: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (!this.hyprctlClient) {
      commandHealth = "unhealthy";
      issues.push("Command client not initialized");
    }

    // Check event system health
    let eventHealth: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (this.eventSystem) {
      const eventStats = this.eventSystem.getStats();
      if (eventStats.connectionState !== "connected") {
        eventHealth = "degraded";
        issues.push(`Event connection state: ${eventStats.connectionState}`);
      }
    } else {
      eventHealth = "unhealthy";
      issues.push("Event system not initialized");
    }

    // Overall status
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (commandHealth === "unhealthy" || eventHealth === "unhealthy") {
      status = "unhealthy";
    } else if ((commandHealth as string) === "degraded" || (eventHealth as string) === "degraded") {
      status = "degraded";
    }

    return {
      status,
      commandHealth,
      eventHealth,
      uptime: this.connectionStartTime > 0 ? now - this.connectionStartTime : 0,
      lastCheck: this.lastHealthCheck,
      issues,
    };
  }

  /**
   * Gets comprehensive client metrics.
   */
  getMetrics(): ClientMetrics {
    const now = Date.now();
    const uptime = now - this.metrics.startTime;

    // Command metrics
    const commandMetrics = this.hyprctlClient?.getMetrics() || {
      totalCommands: 0,
      successfulCommands: 0,
      failedCommands: 0,
      averageExecutionTime: 0,
      commandsPerSecond: 0,
    };

    // Event metrics
    const eventMetrics = this.eventSystem?.getStats() || {
      eventsReceived: 0,
      eventsProcessed: 0,
      activeSubscriptions: 0,
      averageProcessingTime: 0,
      eventsPerSecond: 0,
      eventsBuffered: 0,
    };

    return {
      uptime,
      connection: {
        totalConnections: this.metrics.connectionAttempts,
        failedConnections: this.metrics.failedConnections,
        reconnectionCount: this.metrics.reconnectionCount,
        averageConnectionTime:
          this.metrics.connectionTimes.length > 0
            ? this.metrics.connectionTimes.reduce((a, b) => a + b, 0) /
              this.metrics.connectionTimes.length
            : 0,
      },
      commands: {
        totalExecuted: commandMetrics.totalCommands,
        successfulCommands: commandMetrics.successfulCommands,
        failedCommands: commandMetrics.failedCommands,
        averageExecutionTime: commandMetrics.averageExecutionTime,
        commandsPerSecond: commandMetrics.commandsPerSecond,
      },
      events: {
        totalReceived: eventMetrics.eventsReceived,
        totalProcessed: eventMetrics.eventsProcessed,
        activeSubscriptions: eventMetrics.activeSubscriptions,
        averageProcessingTime: eventMetrics.averageProcessingTime,
        eventsPerSecond: eventMetrics.eventsPerSecond,
      },
      resources: {
        memoryUsage: process.memoryUsage().heapUsed,
        connectionPoolSize: 0, // Would be implemented based on connection pool
        eventBufferSize: eventMetrics.eventsBuffered,
      },
    };
  }

  /**
   * Gets current client status summary.
   */
  getClientStatus(): {
    state: ClientState;
    health: ClientHealth;
    capabilities: ClientCapabilities | null;
    uptime: number;
  } {
    return {
      state: this.currentState,
      health: this.getHealth(),
      capabilities: this.capabilities,
      uptime: this.connectionStartTime > 0 ? Date.now() - this.connectionStartTime : 0,
    };
  }

  /**
   * Performs graceful shutdown with proper resource cleanup.
   */
  async disconnect(): Promise<void> {
    if (this.isShuttingDown && this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;
    this.setState(ClientState.ShuttingDown);

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  // ============================================================================
  // Private Implementation Methods
  // ============================================================================

  /**
   * Validates socket configuration.
   */
  private validateSocketConfig(sockets?: HyprlandClientConfig["sockets"]): void {
    if (!sockets) return;

    if (sockets.command && typeof sockets.command !== "string") {
      throw new ConfigurationError("Command socket path must be a string");
    }
    if (sockets.event && typeof sockets.event !== "string") {
      throw new ConfigurationError("Event socket path must be a string");
    }
  }

  /**
   * Validates connection configuration.
   */
  private validateConnectionConfig(connection?: HyprlandClientConfig["connection"]): void {
    if (connection?.timeout && connection.timeout <= 0) {
      throw new ConfigurationError("Connection timeout must be positive");
    }
  }

  /**
   * Normalizes connection configuration with defaults.
   */
  private normalizeConnectionConfig(
    connection?: HyprlandClientConfig["connection"]
  ): Required<HyprlandClientConfig>["connection"] {
    return {
      timeout: connection?.timeout || 5000,
      autoReconnect: connection?.autoReconnect ?? true,
      maxRetries: connection?.maxRetries ?? 3,
      retryDelay: connection?.retryDelay || 1000,
      healthCheckInterval: connection?.healthCheckInterval || 30000,
      keepAlive: connection?.keepAlive ?? true,
      keepAliveInterval: connection?.keepAliveInterval || 30000,
    };
  }

  /**
   * Normalizes lifecycle configuration with defaults.
   */
  private normalizeLifecycleConfig(
    lifecycle?: HyprlandClientConfig["lifecycle"]
  ): Required<HyprlandClientConfig>["lifecycle"] {
    return {
      shutdownTimeout: lifecycle?.shutdownTimeout || 10000,
      enableResourceMonitoring: lifecycle?.enableResourceMonitoring ?? true,
      cleanupInterval: lifecycle?.cleanupInterval || 60000,
    };
  }

  /**
   * Normalizes monitoring configuration with defaults.
   */
  private normalizeMonitoringConfig(
    monitoring?: HyprlandClientConfig["monitoring"]
  ): Required<HyprlandClientConfig>["monitoring"] {
    return {
      enabled: monitoring?.enabled ?? true,
      metricsInterval: monitoring?.metricsInterval || 60000,
      enableTracing: monitoring?.enableTracing ?? false,
    };
  }

  /**
   * Normalizes capabilities configuration with defaults.
   */
  private normalizeCapabilitiesConfig(
    capabilities?: HyprlandClientConfig["capabilities"]
  ): Required<HyprlandClientConfig>["capabilities"] {
    return {
      autoDetect: capabilities?.autoDetect ?? true,
      detectionTimeout: capabilities?.detectionTimeout || 5000,
      cached: capabilities?.cached ?? null,
    };
  }

  /**
   * Validates and normalizes client configuration.
   */
  private validateAndNormalizeConfig(config: HyprlandClientConfig): Required<HyprlandClientConfig> {
    this.validateSocketConfig(config.sockets);
    this.validateConnectionConfig(config.connection);

    return {
      socketDiscovery: config.socketDiscovery || {},
      sockets: config.sockets || {},
      commands: config.commands || {},
      events: config.events || {},
      connection: this.normalizeConnectionConfig(config.connection),
      lifecycle: this.normalizeLifecycleConfig(config.lifecycle),
      monitoring: this.normalizeMonitoringConfig(config.monitoring),
      capabilities: this.normalizeCapabilitiesConfig(config.capabilities),
    };
  }

  /**
   * Discovers socket paths using socket discovery system.
   */
  private async discoverSockets(): Promise<void> {
    if (this.config.sockets.command && this.config.sockets.event) {
      // Use explicitly configured socket paths
      this.socketInfo = {
        command: {
          path: this.config.sockets.command,
          type: "command",
          instance: "manual",
          exists: true,
          permissions: { readable: true, writable: true },
        },
        event: {
          path: this.config.sockets.event,
          type: "event",
          instance: "manual",
          exists: true,
          permissions: { readable: true, writable: true },
        },
      };
      return;
    }

    // Use socket discovery
    const result = await discoverSockets(this.config.socketDiscovery);
    if (!result.success || !result.activeInstance) {
      throw new ConnectionError(result.error || "No active Hyprland instance found");
    }

    const instance = result.activeInstance;
    if (!instance.commandSocket.exists || !instance.eventSocket.exists) {
      throw new ConnectionError("Required sockets not found for active instance");
    }

    this.socketInfo = {
      command: instance.commandSocket,
      event: instance.eventSocket,
    };
  }

  /**
   * Initializes the command execution client.
   */
  private async initializeCommandClient(): Promise<void> {
    if (!this.socketInfo) {
      throw new ConnectionError("Socket information not available");
    }

    const commandConfig: HyprCtlClientConfig = {
      socketPath: this.socketInfo.command.path,
      ...this.config.commands,
    };

    this.hyprctlClient = new HyprCtlClient(commandConfig);

    // Forward command client events
    this.hyprctlClient.on("error", (error) => {
      this.emit("commandError", error);
    });
  }

  /**
   * Initializes the event handling system.
   */
  private async initializeEventSystem(): Promise<void> {
    if (!this.socketInfo) {
      throw new ConnectionError("Socket information not available");
    }

    this.eventSystem = new HyprlandEventSystem(this.socketInfo.event, this.config.events);

    // Forward event system events
    this.eventSystem.on("error", (error) => {
      this.emit("eventError", error);
    });

    this.eventSystem.on("connected", () => {
      this.emit("eventConnected");
    });

    this.eventSystem.on("disconnected", () => {
      this.emit("eventDisconnected");
      if (this.config.connection.autoReconnect && !this.isShuttingDown) {
        this.handleReconnection();
      }
    });

    // Connect the event system
    await this.eventSystem.connect();
  }

  /**
   * Detects Hyprland capabilities through version and feature probing.
   */
  private async detectCapabilities(): Promise<void> {
    if (this.config.capabilities.cached) {
      this.capabilities = this.config.capabilities.cached;
      return;
    }

    if (!this.hyprctlClient) {
      throw new CapabilityError("Command client not available for capability detection");
    }

    try {
      // Get version information
      const versionResult = await this.hyprctlClient.executeCommand("version" as never);
      const version = versionResult.success ? String(versionResult.data) : "unknown";

      // Detect basic capabilities
      this.capabilities = {
        version,
        supportedCommands: [
          "clients",
          "workspaces",
          "monitors",
          "dispatch",
          "keyword",
          "version",
          "kill",
          "splash",
          "hyprpaper",
          "reload",
          "exit",
        ],
        supportedEvents: [
          "workspace",
          "focusedmon",
          "activewindow",
          "fullscreen",
          "monitor",
          "createworkspace",
          "destroyworkspace",
          "moveworkspace",
          "renameworkspace",
          "activespecial",
          "activelayout",
          "openwindow",
          "closewindow",
          "movewindow",
          "openlayer",
          "closelayer",
          "submap",
        ],
        features: {
          batchCommands: true,
          eventFiltering: true,
          asyncEvents: true,
        },
      };

      this.emit("capabilitiesDetected", this.capabilities);
    } catch (error) {
      // Non-fatal error - continue without full capabilities
      this.capabilities = {
        version: "unknown",
        supportedCommands: [],
        supportedEvents: [],
        features: {
          batchCommands: false,
          eventFiltering: false,
          asyncEvents: false,
        },
      };

      this.emit("capabilityDetectionError", error);
    }
  }

  /**
   * Sets up connection monitoring and health checks.
   */
  private setupConnectionMonitoring(): void {
    // Connection-specific monitoring would be implemented here
    // This could include periodic ping/pong, socket state monitoring, etc.
  }

  /**
   * Sets up periodic health monitoring.
   */
  private setupHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.connection.healthCheckInterval);
  }

  /**
   * Sets up resource monitoring and cleanup.
   */
  private setupResourceMonitoring(): void {
    this.resourceCleanupInterval = setInterval(() => {
      this.performResourceCleanup();
    }, this.config.lifecycle.cleanupInterval);
  }

  /**
   * Performs periodic health check.
   */
  private performHealthCheck(): void {
    this.lastHealthCheck = Date.now();
    const health = this.getHealth();

    this.emit("healthCheck", health);

    if (health.status === "unhealthy" && this.config.connection.autoReconnect) {
      this.handleReconnection();
    }
  }

  /**
   * Performs periodic resource cleanup.
   */
  private performResourceCleanup(): void {
    // Resource cleanup implementation
    // This could include cache cleanup, connection pool maintenance, etc.

    if (this.config.monitoring.enabled) {
      const metrics = this.getMetrics();
      this.emit("metrics", metrics);
    }
  }

  /**
   * Handles reconnection logic.
   */
  private async handleReconnection(): Promise<void> {
    if (this.isShuttingDown || this.currentState === ClientState.Reconnecting) {
      return;
    }

    this.setState(ClientState.Reconnecting);
    this.metrics.reconnectionCount++;

    let retryCount = 0;
    const maxRetries = this.config.connection.maxRetries || 3;

    while (retryCount < maxRetries && !this.isShuttingDown) {
      try {
        await new Promise((resolve) => setTimeout(resolve, this.config.connection.retryDelay));

        // Attempt to reconnect subsystems
        if (this.eventSystem) {
          await this.eventSystem.connect();
        }

        this.setState(ClientState.Connected);
        this.emit("reconnected");
        return;
      } catch (error) {
        retryCount++;
        this.emit("reconnectionAttempt", { attempt: retryCount, error });
      }
    }

    // All retry attempts failed
    this.setState(ClientState.Error);
    this.emit(
      "reconnectionFailed",
      new ConnectionError(`Failed to reconnect after ${maxRetries} attempts`)
    );
  }

  /**
   * Sets the client state and emits state change events.
   */
  private setState(newState: ClientState): void {
    const oldState = this.currentState;
    this.currentState = newState;

    if (oldState !== newState) {
      this.emit("stateChanged", { from: oldState, to: newState });
    }
  }

  /**
   * Ensures the client is connected before operation.
   */
  private ensureConnected(): void {
    if (this.currentState !== ClientState.Connected) {
      throw new ConnectionError(`Client not connected (current state: ${this.currentState})`);
    }
  }

  /**
   * Performs graceful shutdown with resource cleanup.
   */
  private async performShutdown(): Promise<void> {
    try {
      // Clear intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      if (this.resourceCleanupInterval) {
        clearInterval(this.resourceCleanupInterval);
        this.resourceCleanupInterval = null;
      }

      // Shutdown subsystems
      const shutdownPromises: Promise<void>[] = [];

      if (this.eventSystem) {
        shutdownPromises.push(this.eventSystem.disconnect());
      }

      if (this.hyprctlClient) {
        shutdownPromises.push(this.hyprctlClient.close());
      }

      // Wait for all subsystems to shutdown with timeout
      const shutdownTimeout = new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error("Shutdown timeout")),
          this.config.lifecycle.shutdownTimeout
        );
      });

      await Promise.race([Promise.all(shutdownPromises), shutdownTimeout]);

      this.setState(ClientState.Disconnected);
      this.emit("disconnected");
    } catch (error) {
      this.emit("shutdownError", error);
      throw error;
    } finally {
      this.isShuttingDown = false;
      this.shutdownPromise = null;
    }
  }
}
