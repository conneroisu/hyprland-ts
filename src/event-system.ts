/**
 * Comprehensive event subscription and handling system for Hyprland IPC.
 *
 * This module provides a robust, high-performance event system that connects
 * to Hyprland's event socket and delivers type-safe event subscriptions with
 * comprehensive reliability and performance features.
 *
 * Key features:
 * - Type-safe event subscription and handling with strict schema validation
 * - Automatic reconnection with exponential backoff and connection health monitoring
 * - Event buffering and deduplication to prevent duplicate processing
 * - Event ordering guarantees to maintain chronological consistency
 * - Backpressure handling for slow consumers with configurable limits
 * - Event filtering, transformation, and replay capabilities
 * - Performance optimization with efficient event dispatch
 * - Comprehensive statistics and monitoring for analysis
 * - Concurrency safety for multiple handlers and subscriptions
 * - Proper resource cleanup and memory leak prevention
 *
 * @see {@link https://hyprland.org/} - Hyprland window manager
 */

import { EventEmitter } from "node:events";
import { AtomicBoolean, AtomicCounter, Mutex, RateLimiter } from "./concurrency.js";
import {
  ConnectionState,
  SocketConnection,
  type SocketConnectionConfig,
} from "./socket-communication.js";
import type { HyprlandEventData, IPCEvent, SocketInfo } from "./types.js";
import { validateEvent } from "./validation.js";

// ============================================================================
// Constants and Configuration
// ============================================================================

/**
 * Default configuration values for the event system.
 * These values are optimized for reliability and performance.
 */
const DEFAULT_EVENT_CONFIG = {
  /** Maximum number of buffered events before backpressure kicks in */
  maxBufferSize: 10000,
  /** Maximum age of buffered events in milliseconds before cleanup */
  maxEventAge: 30000,
  /** Batch size for event processing */
  eventBatchSize: 100,
  /** Interval for event buffer cleanup in milliseconds */
  cleanupInterval: 5000,
  /** Maximum number of duplicate events to track for deduplication */
  maxDuplicateTrackingSize: 1000,
  /** Event sequence timeout for ordering guarantees in milliseconds */
  sequenceTimeoutMs: 1000,
  /** Maximum number of event handlers per event type */
  maxHandlersPerEvent: 50,
  /** Event replay buffer size for reconnection recovery */
  replayBufferSize: 1000,
  /** Statistics reporting interval in milliseconds */
  statsReportInterval: 60000,
} as const;

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Event handler function type for type-safe callbacks.
 */
export type EventHandler<T extends HyprlandEventData = HyprlandEventData> = (
  event: T,
  metadata: EventMetadata
) => void | Promise<void>;

/**
 * Event predicate function for filtering events.
 */
export type EventPredicate<T extends HyprlandEventData = HyprlandEventData> = (
  event: T,
  metadata: EventMetadata
) => boolean;

/**
 * Event transformer function for modifying events before delivery.
 */
export type EventTransformer<T extends HyprlandEventData = HyprlandEventData> = (
  event: T,
  metadata: EventMetadata
) => T;

/**
 * Metadata associated with each event for tracking and processing.
 */
export interface EventMetadata {
  /** Unique event ID for tracking and deduplication */
  readonly id: string;
  /** Event sequence number for ordering guarantees */
  readonly sequence: number;
  /** Timestamp when event was received */
  readonly receivedAt: number;
  /** Timestamp when event was processed */
  readonly processedAt?: number;
  /** Source socket information */
  readonly source: string;
  /** Number of times this event was retried */
  readonly retryCount: number;
}

/**
 * Configuration options for event subscriptions.
 */
export interface EventSubscriptionOptions<T extends HyprlandEventData = HyprlandEventData> {
  /** Event filter predicate */
  readonly filter?: EventPredicate<T>;
  /** Event transformer function */
  readonly transform?: EventTransformer<T>;
  /** Whether to receive events during replay */
  readonly includeReplay?: boolean;
  /** Maximum number of events to buffer for this subscription */
  readonly bufferLimit?: number;
  /** Priority level for event delivery (higher = processed first) */
  readonly priority?: number;
  /** Whether to handle events synchronously or asynchronously */
  readonly sync?: boolean;
}

/**
 * Event subscription handle for management and cleanup.
 */
export interface EventSubscription {
  /** Unique subscription ID */
  readonly id: string;
  /** Event types this subscription handles */
  readonly eventTypes: readonly string[];
  /** Subscription options */
  readonly options: EventSubscriptionOptions;
  /** Unsubscribe function */
  readonly unsubscribe: () => void;
  /** Get subscription statistics */
  readonly getStats: () => SubscriptionStats;
}

/**
 * Statistics for individual event subscriptions.
 */
export interface SubscriptionStats {
  /** Number of events processed by this subscription */
  readonly eventsProcessed: number;
  /** Number of events filtered out */
  readonly eventsFiltered: number;
  /** Number of processing errors */
  readonly processingErrors: number;
  /** Average processing time in milliseconds */
  readonly averageProcessingTime: number;
  /** Last event processed timestamp */
  readonly lastEventTime?: number | undefined;
}

/**
 * Overall event system statistics for monitoring and analysis.
 */
export interface EventSystemStats {
  /** Current connection state */
  readonly connectionState: ConnectionState;
  /** Total events received */
  readonly eventsReceived: number;
  /** Total events processed */
  readonly eventsProcessed: number;
  /** Total events buffered */
  readonly eventsBuffered: number;
  /** Total events dropped due to backpressure */
  readonly eventsDropped: number;
  /** Total events deduplicated */
  readonly eventsDeduplicated: number;
  /** Number of active subscriptions */
  readonly activeSubscriptions: number;
  /** Average event processing time in milliseconds */
  readonly averageProcessingTime: number;
  /** Events per second throughput */
  readonly eventsPerSecond: number;
  /** Connection uptime in milliseconds */
  readonly uptime: number;
  /** Last reconnection time */
  readonly lastReconnection?: number | undefined;
  /** Total reconnection attempts */
  readonly reconnectionAttempts: number;
  /** Buffer utilization percentage */
  readonly bufferUtilization: number;
}

/**
 * Configuration options for the event system.
 */
export interface EventSystemConfig extends SocketConnectionConfig {
  /** Maximum event buffer size */
  readonly maxBufferSize?: number;
  /** Maximum event age before cleanup */
  readonly maxEventAge?: number;
  /** Event processing batch size */
  readonly eventBatchSize?: number;
  /** Buffer cleanup interval */
  readonly cleanupInterval?: number;
  /** Maximum duplicate tracking size */
  readonly maxDuplicateTrackingSize?: number;
  /** Event sequence timeout */
  readonly sequenceTimeoutMs?: number;
  /** Maximum handlers per event type */
  readonly maxHandlersPerEvent?: number;
  /** Event replay buffer size */
  readonly replayBufferSize?: number;
  /** Statistics reporting interval */
  readonly statsReportInterval?: number;
}

/**
 * Internal event buffer entry for queuing and processing.
 */
interface BufferedEvent {
  readonly event: HyprlandEventData;
  readonly metadata: EventMetadata;
  readonly receivedAt: number;
}

/**
 * Internal subscription registry entry.
 */
interface SubscriptionEntry {
  readonly id: string;
  readonly eventTypes: Set<string>;
  readonly handler: EventHandler;
  readonly options: EventSubscriptionOptions;
  readonly stats: {
    eventsProcessed: number;
    eventsFiltered: number;
    processingErrors: number;
    processingTimes: number[];
    lastEventTime?: number;
  };
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base event system error.
 */
export class EventSystemError extends Error {
  public readonly code: string;
  public readonly eventType?: string;

  constructor(message: string, code: string, eventType?: string) {
    super(message);
    this.name = "EventSystemError";
    this.code = code;
    if (eventType !== undefined) {
      this.eventType = eventType;
    }
  }
}

/**
 * Event validation error.
 */
export class EventValidationError extends EventSystemError {
  constructor(message: string, eventType: string) {
    super(`Event validation failed: ${message}`, "VALIDATION_FAILED", eventType);
    this.name = "EventValidationError";
  }
}

/**
 * Event buffer overflow error.
 */
export class EventBufferOverflowError extends EventSystemError {
  constructor(bufferSize: number, maxSize: number) {
    super(
      `Event buffer overflow: ${bufferSize} events exceeds maximum ${maxSize}`,
      "BUFFER_OVERFLOW"
    );
    this.name = "EventBufferOverflowError";
  }
}

/**
 * Subscription limit error.
 */
export class SubscriptionLimitError extends EventSystemError {
  constructor(eventType: string, currentCount: number, maxCount: number) {
    super(
      `Subscription limit exceeded for '${eventType}': ${currentCount} >= ${maxCount}`,
      "SUBSCRIPTION_LIMIT",
      eventType
    );
    this.name = "SubscriptionLimitError";
  }
}

// ============================================================================
// Event System Class
// ============================================================================

/**
 * Comprehensive event subscription and handling system for Hyprland.
 *
 * Provides type-safe event subscriptions with reliability, performance,
 * and monitoring features for robust Hyprland IPC event handling.
 */
export class HyprlandEventSystem extends EventEmitter {
  private connection: SocketConnection | null = null;
  private readonly config: Required<EventSystemConfig>;
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly eventBuffer: BufferedEvent[] = [];
  private readonly duplicateTracker = new Set<string>();
  private readonly replayBuffer: BufferedEvent[] = [];
  private readonly sequenceCounter = new AtomicCounter();
  private readonly stats: {
    eventsReceived: number;
    eventsProcessed: number;
    eventsDropped: number;
    eventsDeduplicated: number;
    reconnectionAttempts: number;
    lastReconnection?: number;
    processingTimes: number[];
    startTime: number;
  };

  // Concurrency safety primitives
  private readonly bufferMutex = new Mutex();
  private readonly subscriptionMutex = new Mutex();
  private readonly processingMutex = new Mutex();
  private readonly rateLimiter: RateLimiter;
  private readonly isProcessing = new AtomicBoolean(false);
  private readonly isShuttingDown = new AtomicBoolean(false);

  // Timers and intervals
  private cleanupInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private processingInterval: NodeJS.Timeout | null = null;

  private readonly socketInfo: SocketInfo;

  /**
   * Creates a new Hyprland event system instance.
   *
   * @param socketInfo - Event socket information
   * @param config - Optional event system configuration
   */
  constructor(socketInfo: SocketInfo, config: EventSystemConfig = {}) {
    super();
    this.setMaxListeners(0); // Allow unlimited listeners

    this.socketInfo = socketInfo;

    this.config = {
      // Socket connection config
      connectionTimeout: config.connectionTimeout ?? 5000,
      messageTimeout: config.messageTimeout ?? 10000,
      maxRetries: config.maxRetries ?? 3,
      initialRetryDelay: config.initialRetryDelay ?? 100,
      maxRetryDelay: config.maxRetryDelay ?? 5000,
      maxBufferSize: config.maxBufferSize ?? DEFAULT_EVENT_CONFIG.maxBufferSize,
      keepAlive: config.keepAlive ?? true,
      keepAliveInterval: config.keepAliveInterval ?? 30000,
      // Event system specific config
      maxEventAge: config.maxEventAge ?? DEFAULT_EVENT_CONFIG.maxEventAge,
      eventBatchSize: config.eventBatchSize ?? DEFAULT_EVENT_CONFIG.eventBatchSize,
      cleanupInterval: config.cleanupInterval ?? DEFAULT_EVENT_CONFIG.cleanupInterval,
      maxDuplicateTrackingSize:
        config.maxDuplicateTrackingSize ?? DEFAULT_EVENT_CONFIG.maxDuplicateTrackingSize,
      sequenceTimeoutMs: config.sequenceTimeoutMs ?? DEFAULT_EVENT_CONFIG.sequenceTimeoutMs,
      maxHandlersPerEvent: config.maxHandlersPerEvent ?? DEFAULT_EVENT_CONFIG.maxHandlersPerEvent,
      replayBufferSize: config.replayBufferSize ?? DEFAULT_EVENT_CONFIG.replayBufferSize,
      statsReportInterval: config.statsReportInterval ?? DEFAULT_EVENT_CONFIG.statsReportInterval,
    };

    this.stats = {
      eventsReceived: 0,
      eventsProcessed: 0,
      eventsDropped: 0,
      eventsDeduplicated: 0,
      reconnectionAttempts: 0,
      processingTimes: [],
      startTime: Date.now(),
    };

    // Initialize rate limiter: 1000 events per second with burst capacity of 500
    this.rateLimiter = new RateLimiter(500, 1000);

    this.setupIntervals();
  }

  /**
   * Connects to the Hyprland event socket and starts event processing.
   *
   * @returns Promise that resolves when connection is established
   * @throws {EventSystemError} When connection fails
   */
  async connect(): Promise<void> {
    if (this.connection?.isConnected()) {
      return;
    }

    if (await this.isShuttingDown.get()) {
      throw new EventSystemError("Cannot connect: event system is shutting down", "SHUTTING_DOWN");
    }

    try {
      // Create new connection if one doesn't already exist (for testing)
      if (!this.connection) {
        this.connection = new SocketConnection(
          this.socketInfo.path,
          this.socketInfo.type,
          this.config
        );
      }

      // Set up connection event handlers
      this.setupConnectionHandlers();

      // Establish connection
      await this.connection.connect();

      this.emit("connected");
    } catch (error) {
      this.stats.reconnectionAttempts++;
      throw new EventSystemError(
        `Failed to connect to event socket: ${error instanceof Error ? error.message : String(error)}`,
        "CONNECTION_FAILED"
      );
    }
  }

  /**
   * Subscribes to specific event types with a handler function.
   *
   * @param eventTypes - Array of event types to subscribe to
   * @param handler - Event handler function
   * @param options - Subscription options
   * @returns Event subscription handle
   * @throws {SubscriptionLimitError} When subscription limit is exceeded
   */
  async subscribe<T extends HyprlandEventData = HyprlandEventData>(
    eventTypes: string | readonly string[],
    handler: EventHandler<T>,
    options: EventSubscriptionOptions = {}
  ): Promise<EventSubscription> {
    const eventTypeArray = Array.isArray(eventTypes) ? eventTypes : [eventTypes];

    return this.subscriptionMutex.withLock(async () => {
      // Check subscription limits
      for (const eventType of eventTypeArray) {
        const currentCount = Array.from(this.subscriptions.values()).filter((sub) =>
          sub.eventTypes.has(eventType)
        ).length;

        if (currentCount >= this.config.maxHandlersPerEvent) {
          throw new SubscriptionLimitError(
            eventType,
            currentCount,
            this.config.maxHandlersPerEvent
          );
        }
      }

      // Create subscription
      const subscriptionId = this.generateSubscriptionId();
      const subscription: SubscriptionEntry = {
        id: subscriptionId,
        eventTypes: new Set(eventTypeArray),
        handler: handler as EventHandler,
        options,
        stats: {
          eventsProcessed: 0,
          eventsFiltered: 0,
          processingErrors: 0,
          processingTimes: [],
        },
      };

      this.subscriptions.set(subscriptionId, subscription);

      // Create subscription handle
      const subscriptionHandle: EventSubscription = {
        id: subscriptionId,
        eventTypes: eventTypeArray,
        options,
        unsubscribe: () => this.unsubscribe(subscriptionId),
        getStats: () => this.getSubscriptionStats(subscriptionId),
      };

      this.emit("subscribed", subscriptionHandle);
      return subscriptionHandle;
    });
  }

  /**
   * Unsubscribes from events using a subscription ID.
   *
   * @param subscriptionId - Subscription ID to remove
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    await this.subscriptionMutex.withLock(async () => {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        this.subscriptions.delete(subscriptionId);
        this.emit("unsubscribed", subscriptionId);
      }
    });
  }

  /**
   * Gets current event system statistics.
   *
   * @returns Current statistics
   */
  getStats(): EventSystemStats {
    const now = Date.now();
    const uptime = now - this.stats.startTime;
    const eventsPerSecond = uptime > 0 ? (this.stats.eventsProcessed * 1000) / uptime : 0;
    const bufferUtilization = (this.eventBuffer.length / this.config.maxBufferSize) * 100;
    const averageProcessingTime =
      this.stats.processingTimes.length > 0
        ? this.stats.processingTimes.reduce((sum, time) => sum + time, 0) /
          this.stats.processingTimes.length
        : 0;

    return {
      connectionState: this.connection?.getState() ?? ConnectionState.Disconnected,
      eventsReceived: this.stats.eventsReceived,
      eventsProcessed: this.stats.eventsProcessed,
      eventsBuffered: this.eventBuffer.length,
      eventsDropped: this.stats.eventsDropped,
      eventsDeduplicated: this.stats.eventsDeduplicated,
      activeSubscriptions: this.subscriptions.size,
      averageProcessingTime,
      eventsPerSecond,
      uptime,
      lastReconnection: this.stats.lastReconnection,
      reconnectionAttempts: this.stats.reconnectionAttempts,
      bufferUtilization,
    };
  }

  /**
   * Replays buffered events to a specific subscription.
   *
   * @param subscriptionId - Subscription to replay events to
   * @param fromTimestamp - Optional timestamp to replay from
   */
  async replayEvents(subscriptionId: string, fromTimestamp?: number): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription || !subscription.options.includeReplay) {
      return;
    }

    const replayEvents = this.replayBuffer.filter(
      (bufferedEvent) => !fromTimestamp || bufferedEvent.receivedAt >= fromTimestamp
    );

    for (const bufferedEvent of replayEvents) {
      if (this.shouldProcessEvent(bufferedEvent.event, subscription)) {
        await this.processEventForSubscription(
          bufferedEvent.event,
          bufferedEvent.metadata,
          subscription
        );
      }
    }
  }

  /**
   * Disconnects from the event socket and cleans up resources.
   *
   * @returns Promise that resolves when disconnection is complete
   */
  async disconnect(): Promise<void> {
    // Set shutdown flag
    await this.isShuttingDown.compareAndSwap(false, true);

    // Clear intervals
    this.clearIntervals();

    // Close connection
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }

    // Clear buffers and subscriptions
    await this.bufferMutex.withLock(async () => {
      this.eventBuffer.length = 0;
      this.replayBuffer.length = 0;
      this.duplicateTracker.clear();
    });

    await this.subscriptionMutex.withLock(async () => {
      this.subscriptions.clear();
    });

    this.emit("disconnected");
  }

  // ============================================================================
  // Private Implementation Methods
  // ============================================================================

  /**
   * Sets up connection event handlers.
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on("event", this.handleIncomingEvent.bind(this));
    this.connection.on("error", this.handleConnectionError.bind(this));
    this.connection.on("disconnected", this.handleDisconnection.bind(this));
    this.connection.on("reconnecting", this.handleReconnection.bind(this));
  }

  /**
   * Handles incoming events from the socket connection.
   */
  private async handleIncomingEvent(ipcEvent: IPCEvent): Promise<void> {
    try {
      // Apply rate limiting
      await this.rateLimiter.acquire(1, this.config.messageTimeout);

      // Validate event
      const validationResult = validateEvent(ipcEvent.payload);
      if (!validationResult.success) {
        throw new EventValidationError(
          validationResult.errors?.join(", ") ?? "Unknown validation error",
          ipcEvent.payload?.event ?? "unknown"
        );
      }

      const event = validationResult.data;
      if (!event) {
        throw new EventValidationError("Validation succeeded but no data returned", "unknown");
      }
      this.stats.eventsReceived++;

      // Generate event metadata
      const metadata: EventMetadata = {
        id: this.generateEventId(event),
        sequence: await this.sequenceCounter.increment(),
        receivedAt: Date.now(),
        source: this.socketInfo.path,
        retryCount: 0,
      };

      // Check for duplicates
      if (this.duplicateTracker.has(metadata.id)) {
        this.stats.eventsDeduplicated++;
        return;
      }

      // Add to duplicate tracker
      this.duplicateTracker.add(metadata.id);
      if (this.duplicateTracker.size > this.config.maxDuplicateTrackingSize) {
        const firstId = this.duplicateTracker.values().next().value;
        if (firstId !== undefined) {
          this.duplicateTracker.delete(firstId);
        }
      }

      // Buffer event for processing
      await this.bufferEvent(event, metadata);
    } catch (error) {
      this.emit(
        "error",
        new EventSystemError(
          `Event handling failed: ${error instanceof Error ? error.message : String(error)}`,
          "EVENT_HANDLING_FAILED"
        )
      );
    }
  }

  /**
   * Buffers an event for processing.
   */
  private async bufferEvent(event: HyprlandEventData, metadata: EventMetadata): Promise<void> {
    await this.bufferMutex.withLock(async () => {
      // Check buffer overflow
      if (this.eventBuffer.length >= this.config.maxBufferSize) {
        // Drop oldest event
        const droppedEvent = this.eventBuffer.shift();
        if (droppedEvent) {
          this.stats.eventsDropped++;
        }
      }

      // Add to buffer
      const bufferedEvent: BufferedEvent = {
        event,
        metadata,
        receivedAt: Date.now(),
      };

      this.eventBuffer.push(bufferedEvent);

      // Add to replay buffer
      if (this.replayBuffer.length >= this.config.replayBufferSize) {
        this.replayBuffer.shift();
      }
      this.replayBuffer.push(bufferedEvent);

      // Trigger processing if not already running
      if (!(await this.isProcessing.get())) {
        setImmediate(() => this.processEventBuffer());
      }
    });
  }

  /**
   * Processes the event buffer in batches.
   */
  private async processEventBuffer(): Promise<void> {
    const wasProcessing = await this.isProcessing.compareAndSwap(false, true);
    if (!wasProcessing) {
      return; // Already processing
    }

    try {
      await this.processingMutex.withLock(async () => {
        while (this.eventBuffer.length > 0 && !(await this.isShuttingDown.get())) {
          const batchSize = Math.min(this.config.eventBatchSize, this.eventBuffer.length);
          const batch = this.eventBuffer.splice(0, batchSize);

          for (const bufferedEvent of batch) {
            await this.processEvent(bufferedEvent.event, bufferedEvent.metadata);
          }
        }
      });
    } finally {
      await this.isProcessing.set(false);
    }
  }

  /**
   * Processes a single event by dispatching to subscriptions.
   */
  private async processEvent(event: HyprlandEventData, metadata: EventMetadata): Promise<void> {
    const startTime = Date.now();
    const processedMetadata = { ...metadata, processedAt: startTime };

    try {
      // Get matching subscriptions
      const matchingSubscriptions = Array.from(this.subscriptions.values())
        .filter((subscription) => this.shouldProcessEvent(event, subscription))
        .sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0));

      // Process for each subscription
      const promises = matchingSubscriptions.map((subscription) =>
        this.processEventForSubscription(event, processedMetadata, subscription)
      );

      await Promise.allSettled(promises);
      this.stats.eventsProcessed++;

      // Record processing time
      const processingTime = Date.now() - startTime;
      this.stats.processingTimes.push(processingTime);
      if (this.stats.processingTimes.length > 1000) {
        this.stats.processingTimes.shift();
      }

      this.emit("eventProcessed", event, processedMetadata);
    } catch (error) {
      this.emit(
        "error",
        new EventSystemError(
          `Event processing failed: ${error instanceof Error ? error.message : String(error)}`,
          "PROCESSING_FAILED",
          event.event
        )
      );
    }
  }

  /**
   * Processes an event for a specific subscription.
   */
  private async processEventForSubscription(
    event: HyprlandEventData,
    metadata: EventMetadata,
    subscription: SubscriptionEntry
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Apply filter
      if (subscription.options.filter && !subscription.options.filter(event, metadata)) {
        subscription.stats.eventsFiltered++;
        return;
      }

      // Apply transform
      let processedEvent = event;
      if (subscription.options.transform) {
        processedEvent = subscription.options.transform(event, metadata);
      }

      // Call handler
      const handlerResult = subscription.handler(processedEvent, metadata);
      if (handlerResult instanceof Promise) {
        if (subscription.options.sync) {
          await handlerResult;
        } else {
          handlerResult.catch((error) => {
            subscription.stats.processingErrors++;
            this.emit("subscriptionError", subscription.id, error);
          });
        }
      }

      // Update subscription stats
      subscription.stats.eventsProcessed++;
      subscription.stats.lastEventTime = Date.now();

      const processingTime = Date.now() - startTime;
      subscription.stats.processingTimes.push(processingTime);
      if (subscription.stats.processingTimes.length > 100) {
        subscription.stats.processingTimes.shift();
      }
    } catch (error) {
      subscription.stats.processingErrors++;
      this.emit("subscriptionError", subscription.id, error);
    }
  }

  /**
   * Checks if an event should be processed by a subscription.
   */
  private shouldProcessEvent(event: HyprlandEventData, subscription: SubscriptionEntry): boolean {
    return subscription.eventTypes.has(event.event) || subscription.eventTypes.has("*");
  }

  /**
   * Handles connection errors.
   */
  private handleConnectionError(error: Error): void {
    this.emit(
      "error",
      new EventSystemError(`Connection error: ${error.message}`, "CONNECTION_ERROR")
    );
  }

  /**
   * Handles disconnection events.
   */
  private handleDisconnection(): void {
    this.emit("disconnected");
  }

  /**
   * Handles reconnection events.
   */
  private handleReconnection(): void {
    this.stats.reconnectionAttempts++;
    this.stats.lastReconnection = Date.now();
    this.emit("reconnecting");
  }

  /**
   * Gets statistics for a specific subscription.
   */
  private getSubscriptionStats(subscriptionId: string): SubscriptionStats {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return {
        eventsProcessed: 0,
        eventsFiltered: 0,
        processingErrors: 0,
        averageProcessingTime: 0,
      };
    }

    const averageProcessingTime =
      subscription.stats.processingTimes.length > 0
        ? subscription.stats.processingTimes.reduce((sum, time) => sum + time, 0) /
          subscription.stats.processingTimes.length
        : 0;

    return {
      eventsProcessed: subscription.stats.eventsProcessed,
      eventsFiltered: subscription.stats.eventsFiltered,
      processingErrors: subscription.stats.processingErrors,
      averageProcessingTime,
      lastEventTime: subscription.stats.lastEventTime ?? undefined,
    };
  }

  /**
   * Sets up periodic intervals for cleanup and monitoring.
   */
  private setupIntervals(): void {
    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.performCleanup().catch((error) => {
        this.emit(
          "error",
          new EventSystemError(
            `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
            "CLEANUP_FAILED"
          )
        );
      });
    }, this.config.cleanupInterval);

    // Stats reporting interval
    this.statsInterval = setInterval(() => {
      this.emit("statsReport", this.getStats());
    }, this.config.statsReportInterval);
  }

  /**
   * Clears all intervals.
   */
  private clearIntervals(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Performs periodic cleanup of old events and tracking data.
   */
  private async performCleanup(): Promise<void> {
    const now = Date.now();
    const maxAge = this.config.maxEventAge;

    await this.bufferMutex.withLock(async () => {
      // Clean old events from replay buffer
      const cutoffTime = now - maxAge;
      let removed = 0;
      while (this.replayBuffer.length > 0 && (this.replayBuffer[0]?.receivedAt ?? 0) < cutoffTime) {
        this.replayBuffer.shift();
        removed++;
      }

      if (removed > 0) {
        this.emit("cleanupPerformed", { replayEventsRemoved: removed });
      }
    });
  }

  /**
   * Generates a unique event ID for deduplication.
   */
  private generateEventId(event: HyprlandEventData): string {
    return `${event.event}-${JSON.stringify(event.data)}-${Date.now()}`;
  }

  /**
   * Generates a unique subscription ID.
   */
  private generateSubscriptionId(): string {
    return `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
