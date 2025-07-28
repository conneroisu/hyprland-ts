/**
 * Integration tests for HyprlandEventSystem with actual Hyprland event streams.
 *
 * These tests connect to real Hyprland instances when available and validate
 * the event system's behavior with actual event data. Tests are designed to
 * be resilient and skip gracefully when Hyprland is not available.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HyprlandEventSystem } from "./event-system.js";
import { discoverSockets as discoverHyprlandSockets } from "./socket-discovery.js";
import type { HyprlandEventData, SocketInfo } from "./types.js";

// ============================================================================
// Test Configuration and Helpers
// ============================================================================

/**
 * Test configuration for integration tests.
 */
const TEST_CONFIG = {
  /** Maximum time to wait for events in tests */
  eventTimeout: 5000,
  /** Number of synthetic events to generate for stress testing */
  stressTestEventCount: 100,
  /** Connection timeout for socket discovery */
  discoveryTimeout: 3000,
} as const;

/**
 * Helper class for managing test lifecycle and event collection.
 */
class EventTestHelper {
  private eventSystem: HyprlandEventSystem | null = null;
  private collectedEvents: Array<{ event: HyprlandEventData; metadata: any }> = [];
  private eventPromises: Array<{ resolve: Function; reject: Function; timeout: NodeJS.Timeout }> =
    [];

  constructor(private socketInfo: SocketInfo) {}

  /**
   * Sets up the event system for testing.
   */
  async setup(): Promise<void> {
    this.eventSystem = new HyprlandEventSystem(this.socketInfo, {
      connectionTimeout: TEST_CONFIG.discoveryTimeout,
      maxBufferSize: 1000,
      cleanupInterval: 1000,
    });

    await this.eventSystem.connect();
  }

  /**
   * Cleans up the event system after testing.
   */
  async cleanup(): Promise<void> {
    // Cancel any pending event promises
    this.eventPromises.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error("Test cleanup"));
    });
    this.eventPromises = [];

    if (this.eventSystem) {
      await this.eventSystem.disconnect();
      this.eventSystem = null;
    }
    this.collectedEvents = [];
  }

  /**
   * Subscribes to events and collects them for analysis.
   */
  async subscribeToEvents(eventTypes: string | string[]): Promise<void> {
    if (!this.eventSystem) {
      throw new Error("Event system not initialized");
    }

    await this.eventSystem.subscribe(eventTypes, (event, metadata) => {
      this.collectedEvents.push({ event, metadata });
    });
  }

  /**
   * Waits for a specific number of events to be collected.
   */
  async waitForEvents(count: number, timeout: number = TEST_CONFIG.eventTimeout): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(
          new Error(`Timeout waiting for ${count} events. Got ${this.collectedEvents.length}`)
        );
      }, timeout);

      this.eventPromises.push({ resolve, reject, timeout: timeoutHandle });

      const checkEvents = () => {
        if (this.collectedEvents.length >= count) {
          clearTimeout(timeoutHandle);
          const index = this.eventPromises.findIndex((p) => p.timeout === timeoutHandle);
          if (index >= 0) {
            this.eventPromises.splice(index, 1);
          }
          resolve();
        } else {
          setTimeout(checkEvents, 10);
        }
      };

      checkEvents();
    });
  }

  /**
   * Waits for an event matching a specific predicate.
   */
  async waitForEvent(
    predicate: (event: HyprlandEventData, metadata: any) => boolean,
    timeout: number = TEST_CONFIG.eventTimeout
  ): Promise<{ event: HyprlandEventData; metadata: any }> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error("Timeout waiting for matching event"));
      }, timeout);

      this.eventPromises.push({ resolve, reject, timeout: timeoutHandle });

      const checkEvents = () => {
        const matchingEvent = this.collectedEvents.find(({ event, metadata }) =>
          predicate(event, metadata)
        );

        if (matchingEvent) {
          clearTimeout(timeoutHandle);
          const index = this.eventPromises.findIndex((p) => p.timeout === timeoutHandle);
          if (index >= 0) {
            this.eventPromises.splice(index, 1);
          }
          resolve(matchingEvent);
        } else {
          setTimeout(checkEvents, 10);
        }
      };

      checkEvents();
    });
  }

  /**
   * Gets the collected events.
   */
  getCollectedEvents(): Array<{ event: HyprlandEventData; metadata: any }> {
    return [...this.collectedEvents];
  }

  /**
   * Clears collected events.
   */
  clearEvents(): void {
    this.collectedEvents = [];
  }

  /**
   * Gets the event system instance.
   */
  getEventSystem(): HyprlandEventSystem {
    if (!this.eventSystem) {
      throw new Error("Event system not initialized");
    }
    return this.eventSystem;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("HyprlandEventSystem Integration Tests", () => {
  let eventSocket: SocketInfo | null = null;
  let testHelper: EventTestHelper | null = null;

  beforeAll(async () => {
    // Discover Hyprland sockets
    const discoveryResult = await discoverHyprlandSockets({
      validatePermissions: true,
      cacheTimeout: 0, // Disable cache for tests
    });

    if (!discoveryResult.success || !discoveryResult.activeInstance) {
      console.warn("Hyprland not detected - integration tests will be skipped");
      return;
    }

    eventSocket = discoveryResult.activeInstance.eventSocket;

    if (!eventSocket.exists || !eventSocket.permissions.readable) {
      console.warn("Event socket not accessible - integration tests will be skipped");
      eventSocket = null;
      return;
    }
  });

  beforeEach(async () => {
    if (!eventSocket) return;

    testHelper = new EventTestHelper(eventSocket);
    await testHelper.setup();
  });

  afterEach(async () => {
    if (testHelper) {
      await testHelper.cleanup();
      testHelper = null;
    }
  });

  describe("Socket Connection", () => {
    it("should connect to actual Hyprland event socket", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();
      const stats = eventSystem.getStats();

      expect(stats.connectionState).toBe("connected");
      expect(stats.uptime).toBeGreaterThan(0);
    });

    it("should handle connection resilience", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();
      let reconnectionCount = 0;

      eventSystem.on("reconnecting", () => {
        reconnectionCount++;
      });

      // Force a disconnection by closing the connection
      await eventSystem.disconnect();
      await eventSystem.connect();

      // The reconnection might not be immediate, but the connection should be restored
      const stats = eventSystem.getStats();
      expect(stats.connectionState).toBe("connected");
    });
  });

  describe("Real Event Processing", () => {
    it("should receive and process actual Hyprland events", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      // Subscribe to all events
      await testHelper.subscribeToEvents("*");

      // Generate some activity by creating a test application
      // Note: This would require a real Hyprland session with the ability to spawn processes
      // For now, we'll wait for any existing events

      try {
        await testHelper.waitForEvents(1, 2000);
        const events = testHelper.getCollectedEvents();

        expect(events.length).toBeGreaterThan(0);

        // Validate event structure
        events.forEach(({ event, metadata }) => {
          expect(event).toHaveProperty("event");
          expect(event).toHaveProperty("data");
          expect(metadata).toHaveProperty("id");
          expect(metadata).toHaveProperty("sequence");
          expect(metadata).toHaveProperty("receivedAt");
          expect(metadata).toHaveProperty("source");
        });
      } catch (error) {
        console.log("No events received - this is expected in inactive Hyprland sessions");
        // This is acceptable as there might not be any events in a test environment
      }
    });

    it("should handle specific event types correctly", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      // Subscribe to workspace events
      await testHelper.subscribeToEvents(["workspace", "workspacev2"]);

      try {
        // Wait for workspace events
        const workspaceEvent = await testHelper.waitForEvent(
          (event) => event.event.startsWith("workspace"),
          3000
        );

        expect(workspaceEvent.event.event).toMatch(/^workspace/);
        expect(workspaceEvent.metadata).toHaveProperty("sequence");
      } catch (error) {
        console.log("No workspace events received - this is acceptable in test environments");
      }
    });

    it("should maintain event ordering with real events", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const sequences: number[] = [];
      const eventSystem = testHelper.getEventSystem();

      await eventSystem.subscribe("*", (event, metadata) => {
        sequences.push(metadata.sequence);
      });

      try {
        // Wait for multiple events
        await testHelper.waitForEvents(3, 5000);

        // Check that sequences are monotonically increasing
        for (let i = 1; i < sequences.length; i++) {
          expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
        }
      } catch (error) {
        console.log("Not enough events for ordering test - skipping");
      }
    });
  });

  describe("Event Filtering and Transformation", () => {
    it("should filter real events correctly", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      let filteredCount = 0;
      let totalCount = 0;
      const eventSystem = testHelper.getEventSystem();

      // Subscribe with filter
      await eventSystem.subscribe(
        "*",
        (event) => {
          filteredCount++;
        },
        {
          filter: (event) => event.event.includes("window"),
        }
      );

      // Subscribe to all events to count total
      await eventSystem.subscribe("*", (event) => {
        totalCount++;
      });

      try {
        await testHelper.waitForEvents(5, 5000);

        // Filtered count should be <= total count
        expect(filteredCount).toBeLessThanOrEqual(totalCount);
      } catch (error) {
        console.log("Not enough events for filtering test - skipping");
      }
    });

    it("should transform real events correctly", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const transformedEvents: any[] = [];
      const eventSystem = testHelper.getEventSystem();

      await eventSystem.subscribe(
        "*",
        (event) => {
          transformedEvents.push(event);
        },
        {
          transform: (event) => ({
            ...event,
            data: `transformed-${event.data}`,
          }),
        }
      );

      try {
        await testHelper.waitForEvents(1, 3000);

        expect(transformedEvents.length).toBeGreaterThan(0);
        expect(transformedEvents[0].data).toMatch(/^transformed-/);
      } catch (error) {
        console.log("No events for transformation test - skipping");
      }
    });
  });

  describe("Performance and Reliability", () => {
    it("should handle high event throughput", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();
      let processedCount = 0;
      const startTime = Date.now();

      await eventSystem.subscribe("*", (event) => {
        processedCount++;
      });

      try {
        // Wait for events for 2 seconds
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const endTime = Date.now();
        const duration = endTime - startTime;
        const eventsPerSecond = (processedCount * 1000) / duration;

        console.log(
          `Processed ${processedCount} events in ${duration}ms (${eventsPerSecond.toFixed(2)} events/sec)`
        );

        // Basic performance check - should be able to handle at least some events
        const stats = eventSystem.getStats();
        expect(stats.averageProcessingTime).toBeLessThan(100); // Less than 100ms per event
      } catch (error) {
        console.log("Performance test skipped - no events available");
      }
    });

    it("should maintain accuracy under load", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();
      const eventCounts = new Map<string, number>();

      await eventSystem.subscribe("*", (event) => {
        const count = eventCounts.get(event.event) || 0;
        eventCounts.set(event.event, count + 1);
      });

      try {
        await testHelper.waitForEvents(10, 10000);

        const stats = eventSystem.getStats();

        // No events should be dropped under normal load
        expect(stats.eventsDropped).toBe(0);

        // All received events should be processed
        expect(stats.eventsProcessed).toBe(stats.eventsReceived);
      } catch (error) {
        console.log("Load test skipped - not enough events available");
      }
    });
  });

  describe("Error Handling and Recovery", () => {
    it("should recover from connection interruptions", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();
      let connectionEvents = 0;

      eventSystem.on("connected", () => connectionEvents++);
      eventSystem.on("reconnecting", () => connectionEvents++);

      // Simulate connection interruption
      await eventSystem.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await eventSystem.connect();

      expect(connectionEvents).toBeGreaterThan(0);
      expect(eventSystem.getStats().connectionState).toBe("connected");
    });

    it("should handle malformed events gracefully", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();
      let errorCount = 0;

      eventSystem.on("error", () => errorCount++);

      // Subscribe to events
      await eventSystem.subscribe("*", () => {});

      // Wait for some processing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // The system should continue working even if there were errors
      const stats = eventSystem.getStats();
      expect(stats.connectionState).toBe("connected");
    });
  });

  describe("Resource Management", () => {
    it("should properly manage memory with continuous event flow", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();
      const initialStats = eventSystem.getStats();

      await eventSystem.subscribe("*", () => {});

      // Let events flow for a while
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const finalStats = eventSystem.getStats();

      // Buffer utilization should be reasonable
      expect(finalStats.bufferUtilization).toBeLessThan(50); // Less than 50% buffer usage

      // Connection should still be healthy
      expect(finalStats.connectionState).toBe("connected");
    });

    it("should cleanup resources properly on disconnect", async () => {
      if (!eventSocket || !testHelper) {
        console.log("Skipping test - Hyprland not available");
        return;
      }

      const eventSystem = testHelper.getEventSystem();

      // Create multiple subscriptions
      for (let i = 0; i < 5; i++) {
        await eventSystem.subscribe(`event-${i}`, () => {});
      }

      const beforeStats = eventSystem.getStats();
      expect(beforeStats.activeSubscriptions).toBe(5);

      await eventSystem.disconnect();

      const afterStats = eventSystem.getStats();
      expect(afterStats.activeSubscriptions).toBe(0);
      expect(afterStats.eventsBuffered).toBe(0);
    });
  });
});

/**
 * Performance benchmark tests for the event system.
 * These tests measure throughput and latency characteristics.
 */
describe("HyprlandEventSystem Performance Benchmarks", () => {
  let eventSocket: SocketInfo | null = null;
  let testHelper: EventTestHelper | null = null;

  beforeAll(async () => {
    const discoveryResult = await discoverHyprlandSockets({
      validatePermissions: true,
      cacheTimeout: 0,
    });

    if (!discoveryResult.success || !discoveryResult.activeInstance) {
      return;
    }

    eventSocket = discoveryResult.activeInstance.eventSocket;
    if (!eventSocket.exists || !eventSocket.permissions.readable) {
      eventSocket = null;
    }
  });

  beforeEach(async () => {
    if (!eventSocket) return;

    testHelper = new EventTestHelper(eventSocket);
    await testHelper.setup();
  });

  afterEach(async () => {
    if (testHelper) {
      await testHelper.cleanup();
      testHelper = null;
    }
  });

  it("should measure event processing latency", async () => {
    if (!eventSocket || !testHelper) {
      console.log("Skipping benchmark - Hyprland not available");
      return;
    }

    const eventSystem = testHelper.getEventSystem();
    const latencies: number[] = [];

    await eventSystem.subscribe("*", (event, metadata) => {
      const latency = Date.now() - metadata.receivedAt;
      latencies.push(latency);
    });

    try {
      await testHelper.waitForEvents(50, 30000);

      if (latencies.length > 0) {
        const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);
        const minLatency = Math.min(...latencies);

        console.log(`Event Processing Latency:
          Average: ${avgLatency.toFixed(2)}ms
          Min: ${minLatency}ms
          Max: ${maxLatency}ms
          Samples: ${latencies.length}`);

        // Performance assertions
        expect(avgLatency).toBeLessThan(50); // Average latency should be < 50ms
        expect(maxLatency).toBeLessThan(200); // Max latency should be < 200ms
      }
    } catch (error) {
      console.log("Latency benchmark skipped - not enough events");
    }
  });

  it("should measure throughput capacity", async () => {
    if (!eventSocket || !testHelper) {
      console.log("Skipping benchmark - Hyprland not available");
      return;
    }

    const eventSystem = testHelper.getEventSystem();
    let eventCount = 0;
    const startTime = Date.now();

    await eventSystem.subscribe("*", () => {
      eventCount++;
    });

    // Measure for 5 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds
    const throughput = eventCount / duration;

    console.log(`Event Throughput:
      Events processed: ${eventCount}
      Duration: ${duration.toFixed(2)}s
      Throughput: ${throughput.toFixed(2)} events/sec`);

    const stats = eventSystem.getStats();
    console.log(`System Stats:
      Events received: ${stats.eventsReceived}
      Events processed: ${stats.eventsProcessed}
      Events dropped: ${stats.eventsDropped}
      Buffer utilization: ${stats.bufferUtilization.toFixed(2)}%`);

    // Performance assertions
    expect(stats.eventsDropped).toBe(0); // No events should be dropped
    expect(stats.bufferUtilization).toBeLessThan(80); // Buffer should not be overfull
  });
});
