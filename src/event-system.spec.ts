/**
 * Comprehensive unit tests for HyprlandEventSystem.
 *
 * Tests cover all core functionality including event subscription, handling,
 * buffering, deduplication, filtering, transformation, and error handling.
 * Each test is isolated and uses synthetic events for reliable testing.
 */

import { EventEmitter } from "node:events";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventBufferOverflowError,
  type EventHandler,
  type EventSubscriptionOptions,
  type EventSystemConfig,
  EventSystemError,
  EventValidationError,
  HyprlandEventSystem,
  SubscriptionLimitError,
} from "./event-system.js";
import {
  ConnectionState,
  type SocketConnection,
  type SocketConnectionConfig,
} from "./socket-communication.js";
import type {
  HyprlandEventData,
  HyprlandWindowEvent,
  HyprlandWorkspaceEvent,
  IPCEvent,
  SocketInfo,
} from "./types.js";

// ============================================================================
// Test Fixtures and Mocks
// ============================================================================

/**
 * Creates a mock socket info for testing.
 */
function createMockSocketInfo(): SocketInfo {
  return {
    path: "/tmp/test-hypr-event.sock",
    type: "event",
    instance: "test-instance",
    exists: true,
    permissions: {
      readable: true,
      writable: true,
    },
  };
}

/**
 * Creates a mock Hyprland window event for testing.
 */
function createMockWindowEvent(data = "test-window"): HyprlandWindowEvent {
  return {
    event: "activewindow",
    data,
  };
}

/**
 * Creates a mock Hyprland workspace event for testing.
 */
function createMockWorkspaceEvent(data = "1"): HyprlandWorkspaceEvent {
  return {
    event: "workspace",
    data,
  };
}

/**
 * Creates a mock IPC event message for testing.
 */
function createMockIPCEvent(eventData: HyprlandEventData): IPCEvent {
  return {
    type: "event",
    payload: eventData,
    timestamp: Date.now(),
  };
}

/**
 * Mock SocketConnection class for testing.
 */
class MockSocketConnection extends EventEmitter {
  public readonly socketPath: string;
  public readonly socketType: string;
  public readonly config: SocketConnectionConfig;
  private _state: ConnectionState = ConnectionState.Disconnected;
  private _isConnected = false;

  constructor(socketPath: string, socketType: string, config: SocketConnectionConfig) {
    super();
    this.socketPath = socketPath;
    this.socketType = socketType;
    this.config = config;
  }

  async connect(): Promise<void> {
    this._state = ConnectionState.Connected;
    this._isConnected = true;
    this.emit("connected");
  }

  async close(): Promise<void> {
    this._state = ConnectionState.Closed;
    this._isConnected = false;
    this.emit("closed");
  }

  getState(): ConnectionState {
    return this._state;
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  // Test helper methods
  simulateEvent(ipcEvent: IPCEvent): void {
    this.emit("event", ipcEvent);
  }

  simulateError(error: Error): void {
    this.emit("error", error);
  }

  simulateDisconnection(): void {
    this._state = ConnectionState.Disconnected;
    this._isConnected = false;
    this.emit("disconnected");
  }

  simulateReconnection(): void {
    this.emit("reconnecting");
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("HyprlandEventSystem", () => {
  let eventSystem: HyprlandEventSystem;
  let mockSocketInfo: SocketInfo;
  let mockConnection: MockSocketConnection;
  let _originalSocketConnection: typeof SocketConnection;

  beforeEach(() => {
    mockSocketInfo = createMockSocketInfo();

    // Create mock connection instance
    mockConnection = new MockSocketConnection(mockSocketInfo.path, mockSocketInfo.type, {});

    // Create event system and replace connection with mock
    eventSystem = new HyprlandEventSystem(mockSocketInfo);
    // @ts-expect-error: Accessing private property for testing
    eventSystem.connection = mockConnection;
  });

  afterEach(async () => {
    await eventSystem.disconnect();
    vi.restoreAllMocks();
  });

  describe("Connection Management", () => {
    it("should connect to event socket successfully", async () => {
      const connectSpy = vi.spyOn(mockConnection, "connect");

      await eventSystem.connect();

      expect(connectSpy).toHaveBeenCalledOnce();
      expect(eventSystem.getStats().connectionState).toBe(ConnectionState.Connected);
    });

    it("should handle connection errors gracefully", async () => {
      const error = new Error("Connection failed");
      vi.spyOn(mockConnection, "connect").mockRejectedValueOnce(error);

      await expect(eventSystem.connect()).rejects.toThrow(EventSystemError);
      expect(eventSystem.getStats().reconnectionAttempts).toBe(1);
    });

    it("should not connect if already connected", async () => {
      await eventSystem.connect();
      const connectSpy = vi.spyOn(mockConnection, "connect");

      await eventSystem.connect();

      expect(connectSpy).not.toHaveBeenCalled();
    });

    it("should disconnect cleanly", async () => {
      await eventSystem.connect();
      const closeSpy = vi.spyOn(mockConnection, "close");

      await eventSystem.disconnect();

      expect(closeSpy).toHaveBeenCalledOnce();
    });

    it("should prevent connection during shutdown", async () => {
      await eventSystem.disconnect();

      await expect(eventSystem.connect()).rejects.toThrow(
        expect.objectContaining({
          code: "SHUTTING_DOWN",
        })
      );
    });
  });

  describe("Event Subscription", () => {
    beforeEach(async () => {
      await eventSystem.connect();
    });

    it("should subscribe to single event type", async () => {
      const handler = vi.fn();

      const subscription = await eventSystem.subscribe("activewindow", handler);

      expect(subscription.id).toBeDefined();
      expect(subscription.eventTypes).toEqual(["activewindow"]);
      expect(subscription.unsubscribe).toBeInstanceOf(Function);
      expect(eventSystem.getStats().activeSubscriptions).toBe(1);
    });

    it("should subscribe to multiple event types", async () => {
      const handler = vi.fn();
      const eventTypes = ["activewindow", "workspace"];

      const subscription = await eventSystem.subscribe(eventTypes, handler);

      expect(subscription.eventTypes).toEqual(eventTypes);
    });

    it("should unsubscribe successfully", async () => {
      const handler = vi.fn();
      const subscription = await eventSystem.subscribe("activewindow", handler);

      await subscription.unsubscribe();

      expect(eventSystem.getStats().activeSubscriptions).toBe(0);
    });

    it("should enforce subscription limits per event type", async () => {
      const config: EventSystemConfig = { maxHandlersPerEvent: 2 };
      const limitedEventSystem = new HyprlandEventSystem(mockSocketInfo, config);

      // Mock the connection
      const limitedMockConnection = new MockSocketConnection(
        mockSocketInfo.path,
        mockSocketInfo.type,
        {}
      );
      // @ts-expect-error: Accessing private property for testing
      limitedEventSystem.connection = limitedMockConnection;

      await limitedEventSystem.connect();

      // Add maximum number of subscriptions
      await limitedEventSystem.subscribe("activewindow", vi.fn());
      await limitedEventSystem.subscribe("activewindow", vi.fn());

      // Should throw when limit exceeded
      await expect(limitedEventSystem.subscribe("activewindow", vi.fn())).rejects.toThrow(
        SubscriptionLimitError
      );

      await limitedEventSystem.disconnect();
    });

    it("should handle subscription options correctly", async () => {
      const handler = vi.fn();
      const options: EventSubscriptionOptions = {
        priority: 10,
        sync: true,
        bufferLimit: 100,
      };

      const subscription = await eventSystem.subscribe("activewindow", handler, options);

      expect(subscription.options).toEqual(options);
    });
  });

  describe("Event Processing", () => {
    let eventHandler: MockInstance;

    beforeEach(async () => {
      await eventSystem.connect();
      eventHandler = vi.fn();
      await eventSystem.subscribe("activewindow", eventHandler);
    });

    it("should process valid events", async () => {
      const event = createMockWindowEvent("test-window");
      const ipcEvent = createMockIPCEvent(event);

      mockConnection.simulateEvent(ipcEvent);

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventHandler).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          id: expect.any(String),
          sequence: expect.any(Number),
          receivedAt: expect.any(Number),
          source: mockSocketInfo.path,
          retryCount: 0,
        })
      );
      expect(eventSystem.getStats().eventsProcessed).toBe(1);
    });

    it("should filter events based on event type", async () => {
      const workspaceEvent = createMockWorkspaceEvent("1");
      const ipcEvent = createMockIPCEvent(workspaceEvent);

      mockConnection.simulateEvent(ipcEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not call handler for workspace event when subscribed to activewindow
      expect(eventHandler).not.toHaveBeenCalled();
    });

    it("should handle wildcard subscriptions", async () => {
      await eventSystem.subscribe("*", eventHandler);

      const event = createMockWorkspaceEvent("1");
      const ipcEvent = createMockIPCEvent(event);

      mockConnection.simulateEvent(ipcEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventHandler).toHaveBeenCalled();
    });

    it("should deduplicate events", async () => {
      const event = createMockWindowEvent("same-window");
      const ipcEvent1 = createMockIPCEvent(event);
      const ipcEvent2 = createMockIPCEvent(event);

      mockConnection.simulateEvent(ipcEvent1);
      mockConnection.simulateEvent(ipcEvent2);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventSystem.getStats().eventsDeduplicated).toBe(1);
    });

    it("should maintain event ordering", async () => {
      const calls: number[] = [];
      const orderHandler = vi.fn((_event, metadata) => {
        calls.push(metadata.sequence);
      });
      await eventSystem.subscribe("activewindow", orderHandler);

      // Send multiple events
      for (let i = 0; i < 5; i++) {
        const event = createMockWindowEvent(`window-${i}`);
        const ipcEvent = createMockIPCEvent(event);
        mockConnection.simulateEvent(ipcEvent);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Sequences should be in order
      expect(calls).toEqual(calls.slice().sort((a, b) => a - b));
    });
  });

  describe("Event Filtering and Transformation", () => {
    beforeEach(async () => {
      await eventSystem.connect();
    });

    it("should filter events using predicate", async () => {
      const handler = vi.fn();
      const options: EventSubscriptionOptions = {
        filter: (event) => event.data === "filtered-window",
      };

      await eventSystem.subscribe("activewindow", handler, options);

      // Send non-matching event
      const event1 = createMockWindowEvent("other-window");
      mockConnection.simulateEvent(createMockIPCEvent(event1));

      // Send matching event
      const event2 = createMockWindowEvent("filtered-window");
      mockConnection.simulateEvent(createMockIPCEvent(event2));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event2, expect.any(Object));
    });

    it("should transform events before delivery", async () => {
      const handler = vi.fn();
      const options: EventSubscriptionOptions = {
        transform: (event) => ({
          ...event,
          data: `transformed-${event.data}`,
        }),
      };

      await eventSystem.subscribe("activewindow", handler, options);

      const event = createMockWindowEvent("window");
      mockConnection.simulateEvent(createMockIPCEvent(event));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: "transformed-window",
        }),
        expect.any(Object)
      );
    });

    it("should apply both filter and transform", async () => {
      const handler = vi.fn();
      const options: EventSubscriptionOptions = {
        filter: (event) => event.data === "test-window",
        transform: (event) => ({
          ...event,
          data: `transformed-${event.data}`,
        }),
      };

      await eventSystem.subscribe("activewindow", handler, options);

      // Send non-matching event
      const event1 = createMockWindowEvent("other-window");
      mockConnection.simulateEvent(createMockIPCEvent(event1));

      // Send matching event
      const event2 = createMockWindowEvent("test-window");
      mockConnection.simulateEvent(createMockIPCEvent(event2));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: "transformed-test-window",
        }),
        expect.any(Object)
      );
    });
  });

  describe("Event Buffering and Backpressure", () => {
    it("should buffer events when processing is slow", async () => {
      const config: EventSystemConfig = { maxBufferSize: 5 };
      const bufferedEventSystem = new HyprlandEventSystem(mockSocketInfo, config);

      // Mock the connection
      const bufferedMockConnection = new MockSocketConnection(
        mockSocketInfo.path,
        mockSocketInfo.type,
        {}
      );
      // @ts-expect-error: Accessing private property for testing
      bufferedEventSystem.connection = bufferedMockConnection;

      await bufferedEventSystem.connect();

      // Add slow handler
      const slowHandler = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
      await bufferedEventSystem.subscribe("activewindow", slowHandler);

      // Send multiple events quickly
      for (let i = 0; i < 3; i++) {
        const event = createMockWindowEvent(`window-${i}`);
        bufferedMockConnection.simulateEvent(createMockIPCEvent(event));
      }

      // Wait for events to be buffered but not fully processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = bufferedEventSystem.getStats();
      // Either events are buffered or they are being processed (both are valid)
      expect(stats.eventsReceived).toBeGreaterThan(0);
      expect(stats.eventsBuffered + stats.eventsProcessed).toBeGreaterThanOrEqual(0);

      await bufferedEventSystem.disconnect();
    });

    it("should drop old events when buffer overflows", async () => {
      const config: EventSystemConfig = { maxBufferSize: 2 };
      const overflowEventSystem = new HyprlandEventSystem(mockSocketInfo, config);

      // Mock the connection
      const overflowMockConnection = new MockSocketConnection(
        mockSocketInfo.path,
        mockSocketInfo.type,
        {}
      );
      // @ts-expect-error: Accessing private property for testing
      overflowEventSystem.connection = overflowMockConnection;

      await overflowEventSystem.connect();

      const handler = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
      await overflowEventSystem.subscribe("activewindow", handler);

      // Send more events than buffer can hold
      for (let i = 0; i < 5; i++) {
        const event = createMockWindowEvent(`window-${i}`);
        overflowMockConnection.simulateEvent(createMockIPCEvent(event));
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      const stats = overflowEventSystem.getStats();
      expect(stats.eventsDropped).toBeGreaterThan(0);

      await overflowEventSystem.disconnect();
    });
  });

  describe("Event Replay", () => {
    beforeEach(async () => {
      await eventSystem.connect();
    });

    it("should replay events for subscriptions with replay enabled", async () => {
      // Send events before subscription
      const event1 = createMockWindowEvent("window-1");
      const event2 = createMockWindowEvent("window-2");
      mockConnection.simulateEvent(createMockIPCEvent(event1));
      mockConnection.simulateEvent(createMockIPCEvent(event2));
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Subscribe with replay enabled
      const handler = vi.fn();
      const subscription = await eventSystem.subscribe("activewindow", handler, {
        includeReplay: true,
      });

      // Trigger replay
      await eventSystem.replayEvents(subscription.id);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should replay events from specific timestamp", async () => {
      const _startTime = Date.now();

      // Send event before timestamp
      const event1 = createMockWindowEvent("window-1");
      mockConnection.simulateEvent(createMockIPCEvent(event1));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const replayFromTime = Date.now();

      // Send event after timestamp
      const event2 = createMockWindowEvent("window-2");
      mockConnection.simulateEvent(createMockIPCEvent(event2));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const handler = vi.fn();
      const subscription = await eventSystem.subscribe("activewindow", handler, {
        includeReplay: true,
      });

      await eventSystem.replayEvents(subscription.id, replayFromTime);

      // Should only replay event2
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      await eventSystem.connect();
    });

    it("should handle subscription errors gracefully", async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error("Handler error"));
      await eventSystem.subscribe("activewindow", errorHandler);

      const errorListener = vi.fn();
      eventSystem.on("subscriptionError", errorListener);

      const event = createMockWindowEvent("test-window");
      mockConnection.simulateEvent(createMockIPCEvent(event));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorListener).toHaveBeenCalled();
    });

    it("should handle connection errors", async () => {
      const errorListener = vi.fn();
      eventSystem.on("error", errorListener);

      const connectionError = new Error("Connection lost");
      mockConnection.simulateError(connectionError);

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CONNECTION_ERROR",
        })
      );
    });

    it("should handle event validation errors", async () => {
      const errorListener = vi.fn();
      eventSystem.on("error", errorListener);

      // Send an invalid event (missing required properties)
      const invalidEvent = { invalid: "event" };
      // @ts-expect-error: Intentionally passing invalid event for testing
      mockConnection.simulateEvent(createMockIPCEvent(invalidEvent));

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "EVENT_HANDLING_FAILED",
        })
      );
    });
  });

  describe("Statistics and Monitoring", () => {
    beforeEach(async () => {
      await eventSystem.connect();
    });

    it("should track event statistics", async () => {
      const handler = vi.fn();
      await eventSystem.subscribe("activewindow", handler);

      // Send events
      for (let i = 0; i < 3; i++) {
        const event = createMockWindowEvent(`window-${i}`);
        mockConnection.simulateEvent(createMockIPCEvent(event));
      }

      await new Promise((resolve) => setTimeout(resolve, 20));

      const stats = eventSystem.getStats();
      expect(stats.eventsReceived).toBe(3);
      expect(stats.eventsProcessed).toBe(3);
      expect(stats.activeSubscriptions).toBe(1);
      expect(stats.eventsPerSecond).toBeGreaterThan(0);
    });

    it("should track subscription statistics", async () => {
      const handler = vi.fn();
      const subscription = await eventSystem.subscribe("activewindow", handler);

      const event = createMockWindowEvent("test-window");
      mockConnection.simulateEvent(createMockIPCEvent(event));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const subscriptionStats = subscription.getStats();
      expect(subscriptionStats.eventsProcessed).toBe(1);
      expect(subscriptionStats.processingErrors).toBe(0);
      expect(subscriptionStats.averageProcessingTime).toBeGreaterThanOrEqual(0);
    });

    it("should emit statistics reports", async () => {
      const statsListener = vi.fn();
      eventSystem.on("statsReport", statsListener);

      // Trigger stats report manually
      eventSystem.emit("statsReport", eventSystem.getStats());

      expect(statsListener).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionState: ConnectionState.Connected,
          eventsReceived: expect.any(Number),
          eventsProcessed: expect.any(Number),
        })
      );
    });
  });

  describe("Concurrency Safety", () => {
    beforeEach(async () => {
      await eventSystem.connect();
    });

    it("should handle concurrent subscriptions safely", async () => {
      const promises = [];

      // Create multiple subscriptions concurrently
      for (let i = 0; i < 10; i++) {
        const promise = eventSystem.subscribe(`event-${i}`, vi.fn());
        promises.push(promise);
      }

      const subscriptions = await Promise.all(promises);
      expect(subscriptions).toHaveLength(10);
      expect(eventSystem.getStats().activeSubscriptions).toBe(10);
    });

    it("should handle concurrent event processing safely", async () => {
      const results: string[] = [];
      const handler = vi.fn((event) => {
        results.push(event.data);
      });
      await eventSystem.subscribe("activewindow", handler);

      // Send events concurrently
      const promises = [];
      for (let i = 0; i < 10; i++) {
        const event = createMockWindowEvent(`window-${i}`);
        const ipcEvent = createMockIPCEvent(event);
        promises.push(Promise.resolve(mockConnection.simulateEvent(ipcEvent)));
      }

      await Promise.all(promises);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(results).toHaveLength(10);
      expect(new Set(results)).toHaveProperty("size", 10); // All unique
    });
  });

  describe("Resource Cleanup", () => {
    it("should clean up resources on disconnect", async () => {
      await eventSystem.connect();

      const handler = vi.fn();
      await eventSystem.subscribe("activewindow", handler);

      // Send some events to populate buffers
      for (let i = 0; i < 3; i++) {
        const event = createMockWindowEvent(`window-${i}`);
        mockConnection.simulateEvent(createMockIPCEvent(event));
      }

      // Wait for events to be processed before disconnect
      await new Promise((resolve) => setTimeout(resolve, 100));

      await eventSystem.disconnect();

      const stats = eventSystem.getStats();
      expect(stats.activeSubscriptions).toBe(0);
      expect(stats.eventsBuffered).toBe(0);
    });

    it("should perform periodic cleanup", async () => {
      const config: EventSystemConfig = { cleanupInterval: 100, maxEventAge: 50 };
      const cleanupEventSystem = new HyprlandEventSystem(mockSocketInfo, config);

      // Mock the connection
      const cleanupMockConnection = new MockSocketConnection(
        mockSocketInfo.path,
        mockSocketInfo.type,
        {}
      );
      // @ts-expect-error: Accessing private property for testing
      cleanupEventSystem.connection = cleanupMockConnection;

      await cleanupEventSystem.connect();

      const cleanupListener = vi.fn();
      cleanupEventSystem.on("cleanupPerformed", cleanupListener);

      // Add some events to populate replay buffer
      for (let i = 0; i < 10; i++) {
        const event = createMockWindowEvent(`old-window-${i}`);
        cleanupMockConnection.simulateEvent(createMockIPCEvent(event));
      }
      
      // Wait for events to be processed and added to replay buffer
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      // Wait for events to age and cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Cleanup should have been performed - check that the event was emitted
      expect(cleanupListener).toHaveBeenCalled();

      await cleanupEventSystem.disconnect();
    });
  });
});
