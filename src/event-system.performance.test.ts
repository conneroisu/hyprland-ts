/**
 * Performance tests and optimization verification for HyprlandEventSystem.
 *
 * These tests measure and verify the performance characteristics of the event
 * system under various load conditions, stress scenarios, and optimization paths.
 * Includes throughput benchmarks, latency measurements, memory usage analysis,
 * and scalability testing.
 */

import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EventHandler, type EventSystemConfig, HyprlandEventSystem } from "./event-system.js";
import type { HyprlandEventData, IPCEvent, SocketInfo } from "./types.js";

// ============================================================================
// Performance Test Configuration
// ============================================================================

/**
 * Performance test thresholds and configuration.
 */
const PERF_CONFIG = {
  /** Maximum acceptable event processing latency in milliseconds */
  maxLatencyMs: 10,
  /** Minimum acceptable throughput in events per second */
  minThroughputEps: 1000,
  /** Maximum acceptable memory growth per 1000 events in MB */
  maxMemoryGrowthMb: 1,
  /** Number of events for stress testing */
  stressTestEvents: 10000,
  /** Number of concurrent subscriptions for scalability testing */
  scalabilitySubscriptions: 100,
  /** Batch sizes to test for optimal performance */
  batchSizes: [1, 10, 50, 100, 500],
  /** Buffer sizes to test for memory optimization */
  bufferSizes: [100, 1000, 5000, 10000],
} as const;

// ============================================================================
// Test Utilities and Helpers
// ============================================================================

/**
 * Mock socket connection for performance testing with controlled event generation.
 */
class PerformanceMockConnection extends EventEmitter {
  private _isConnected = false;
  private eventGenerationTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly socketPath: string,
    public readonly socketType: string,
    public readonly config: any
  ) {
    super();
  }

  async connect(): Promise<void> {
    this._isConnected = true;
    this.emit("connected");
  }

  async close(): Promise<void> {
    this._isConnected = false;
    if (this.eventGenerationTimer) {
      clearInterval(this.eventGenerationTimer);
      this.eventGenerationTimer = null;
    }
    this.emit("closed");
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  getState(): string {
    return this._isConnected ? "connected" : "disconnected";
  }

  /**
   * Generates synthetic events at a controlled rate for performance testing.
   */
  startEventGeneration(eventsPerSecond: number, eventCount?: number): void {
    if (this.eventGenerationTimer) {
      clearInterval(this.eventGenerationTimer);
    }

    const intervalMs = 1000 / eventsPerSecond;
    let generatedCount = 0;

    this.eventGenerationTimer = setInterval(() => {
      if (eventCount && generatedCount >= eventCount) {
        this.stopEventGeneration();
        return;
      }

      const event: HyprlandEventData = {
        event: "activewindow",
        data: `perf-test-window-${generatedCount}`,
      };

      const ipcEvent: IPCEvent = {
        type: "event",
        payload: event,
        timestamp: Date.now(),
      };

      this.emit("event", ipcEvent);
      generatedCount++;
    }, intervalMs);
  }

  /**
   * Stops event generation.
   */
  stopEventGeneration(): void {
    if (this.eventGenerationTimer) {
      clearInterval(this.eventGenerationTimer);
      this.eventGenerationTimer = null;
    }
  }

  /**
   * Generates a burst of events for stress testing.
   */
  generateEventBurst(count: number): void {
    for (let i = 0; i < count; i++) {
      const event: HyprlandEventData = {
        event: `burst-event-${i % 10}`, // Vary event types
        data: `burst-data-${i}`,
      };

      const ipcEvent: IPCEvent = {
        type: "event",
        payload: event,
        timestamp: Date.now(),
      };

      setImmediate(() => this.emit("event", ipcEvent));
    }
  }
}

/**
 * Performance measurement utility class.
 */
class PerformanceTracker {
  private measurements: Map<string, number[]> = new Map();
  private startTimes: Map<string, number> = new Map();
  private memoryBaseline = 0;

  /**
   * Starts a performance measurement.
   */
  startMeasurement(name: string): void {
    this.startTimes.set(name, performance.now());
  }

  /**
   * Ends a performance measurement and records the duration.
   */
  endMeasurement(name: string): number {
    const startTime = this.startTimes.get(name);
    if (!startTime) {
      throw new Error(`No start time found for measurement: ${name}`);
    }

    const duration = performance.now() - startTime;
    const measurements = this.measurements.get(name) || [];
    measurements.push(duration);
    this.measurements.set(name, measurements);
    this.startTimes.delete(name);

    return duration;
  }

  /**
   * Gets statistics for a measurement.
   */
  getStats(name: string): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const measurements = this.measurements.get(name);
    if (!measurements || measurements.length === 0) {
      return null;
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    const count = sorted.length;

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: sorted.reduce((sum, val) => sum + val, 0) / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  /**
   * Records memory usage baseline.
   */
  recordMemoryBaseline(): void {
    const memUsage = process.memoryUsage();
    this.memoryBaseline = memUsage.heapUsed;
  }

  /**
   * Gets memory growth since baseline in MB.
   */
  getMemoryGrowth(): number {
    const memUsage = process.memoryUsage();
    return (memUsage.heapUsed - this.memoryBaseline) / (1024 * 1024);
  }

  /**
   * Clears all measurements.
   */
  clear(): void {
    this.measurements.clear();
    this.startTimes.clear();
  }
}

/**
 * Creates a mock socket info for performance testing.
 */
function createPerfSocketInfo(): SocketInfo {
  return {
    path: "/tmp/perf-test-hypr-event.sock",
    type: "event",
    instance: "perf-test-instance",
    exists: true,
    permissions: {
      readable: true,
      writable: true,
    },
  };
}

// ============================================================================
// Performance Test Suite
// ============================================================================

describe("HyprlandEventSystem Performance Tests", () => {
  let eventSystem: HyprlandEventSystem;
  let mockConnection: PerformanceMockConnection;
  let perfTracker: PerformanceTracker;
  let socketInfo: SocketInfo;

  beforeEach(() => {
    socketInfo = createPerfSocketInfo();
    mockConnection = new PerformanceMockConnection(socketInfo.path, socketInfo.type, {});
    perfTracker = new PerformanceTracker();

    // Create event system with performance monitoring
    eventSystem = new HyprlandEventSystem(socketInfo, {
      maxBufferSize: 10000,
      eventBatchSize: 100,
      cleanupInterval: 10000, // Longer interval to not interfere with tests
    });

    // Replace the connection with our mock
    (eventSystem as any).connection = mockConnection;
  });

  afterEach(async () => {
    mockConnection.stopEventGeneration();
    await eventSystem.disconnect();
    perfTracker.clear();
  });

  describe("Throughput Benchmarks", () => {
    it("should handle high-frequency event streams efficiently", async () => {
      await eventSystem.connect();

      let processedCount = 0;
      const startTime = performance.now();

      await eventSystem.subscribe("*", () => {
        processedCount++;
      });

      // Generate 5000 events at 2000 events/sec
      mockConnection.startEventGeneration(2000, 5000);

      // Wait for all events to be processed
      await new Promise<void>((resolve) => {
        const checkCompletion = () => {
          if (processedCount >= 5000) {
            resolve();
          } else {
            setTimeout(checkCompletion, 10);
          }
        };
        checkCompletion();
      });

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000; // Convert to seconds
      const throughput = processedCount / duration;

      console.log(`Throughput Test Results:
        Events processed: ${processedCount}
        Duration: ${duration.toFixed(3)}s
        Throughput: ${throughput.toFixed(0)} events/sec`);

      expect(throughput).toBeGreaterThan(PERF_CONFIG.minThroughputEps);

      const stats = eventSystem.getStats();
      expect(stats.eventsDropped).toBe(0);
    });

    it("should maintain throughput under burst load", async () => {
      await eventSystem.connect();

      let processedCount = 0;
      const batchSize = 1000;

      await eventSystem.subscribe("*", () => {
        processedCount++;
      });

      perfTracker.recordMemoryBaseline();
      const startTime = performance.now();

      // Generate multiple bursts
      for (let i = 0; i < 5; i++) {
        mockConnection.generateEventBurst(batchSize);
        await new Promise((resolve) => setTimeout(resolve, 50)); // Small delay between bursts
      }

      // Wait for processing to complete
      await new Promise<void>((resolve) => {
        const checkCompletion = () => {
          if (processedCount >= 5000) {
            resolve();
          } else {
            setTimeout(checkCompletion, 10);
          }
        };
        checkCompletion();
      });

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;
      const throughput = processedCount / duration;
      const memoryGrowth = perfTracker.getMemoryGrowth();

      console.log(`Burst Load Test Results:
        Events processed: ${processedCount}
        Duration: ${duration.toFixed(3)}s
        Throughput: ${throughput.toFixed(0)} events/sec
        Memory growth: ${memoryGrowth.toFixed(2)}MB`);

      expect(throughput).toBeGreaterThan(PERF_CONFIG.minThroughputEps / 2); // Allow lower throughput under burst
      expect(memoryGrowth).toBeLessThan(PERF_CONFIG.maxMemoryGrowthMb * 5); // 5x events
    });
  });

  describe("Latency Measurements", () => {
    it("should maintain low processing latency", async () => {
      await eventSystem.connect();

      const latencies: number[] = [];

      await eventSystem.subscribe("activewindow", (event, metadata) => {
        const latency = performance.now() - metadata.receivedAt;
        latencies.push(latency);
      });

      // Generate events with timestamps
      for (let i = 0; i < 1000; i++) {
        const event: HyprlandEventData = {
          event: "activewindow",
          data: `latency-test-${i}`,
        };

        const ipcEvent: IPCEvent = {
          type: "event",
          payload: event,
          timestamp: performance.now(),
        };

        mockConnection.emit("event", ipcEvent);

        // Small delay to avoid overwhelming the system
        if (i % 100 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }

      // Wait for processing
      await new Promise<void>((resolve) => {
        const checkCompletion = () => {
          if (latencies.length >= 1000) {
            resolve();
          } else {
            setTimeout(checkCompletion, 10);
          }
        };
        checkCompletion();
      });

      const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

      console.log(`Latency Test Results:
        Samples: ${latencies.length}
        Average latency: ${avgLatency.toFixed(3)}ms
        Max latency: ${maxLatency.toFixed(3)}ms
        P95 latency: ${p95Latency.toFixed(3)}ms`);

      expect(avgLatency).toBeLessThan(PERF_CONFIG.maxLatencyMs);
      expect(p95Latency).toBeLessThan(PERF_CONFIG.maxLatencyMs * 2);
    });

    it("should handle concurrent subscriptions efficiently", async () => {
      await eventSystem.connect();

      const subscriptionLatencies: number[][] = [];

      // Create multiple subscriptions
      for (let i = 0; i < 20; i++) {
        const latencies: number[] = [];
        subscriptionLatencies.push(latencies);

        await eventSystem.subscribe("activewindow", (event, metadata) => {
          const latency = performance.now() - metadata.receivedAt;
          latencies.push(latency);
        });
      }

      // Generate events
      mockConnection.startEventGeneration(500, 1000);

      // Wait for processing
      await new Promise<void>((resolve) => {
        const checkCompletion = () => {
          const totalProcessed = subscriptionLatencies.reduce(
            (sum, latencies) => sum + latencies.length,
            0
          );
          if (totalProcessed >= 20000) {
            // 1000 events * 20 subscriptions
            resolve();
          } else {
            setTimeout(checkCompletion, 10);
          }
        };
        checkCompletion();
      });

      // Analyze latencies across subscriptions
      const allLatencies = subscriptionLatencies.flat();
      const avgLatency = allLatencies.reduce((sum, lat) => sum + lat, 0) / allLatencies.length;

      console.log(`Concurrent Subscription Test Results:
        Subscriptions: 20
        Total events processed: ${allLatencies.length}
        Average latency: ${avgLatency.toFixed(3)}ms`);

      expect(avgLatency).toBeLessThan(PERF_CONFIG.maxLatencyMs * 1.5); // Allow slightly higher latency
    });
  });

  describe("Memory Usage Optimization", () => {
    it("should maintain stable memory usage under continuous load", async () => {
      await eventSystem.connect();

      let processedCount = 0;
      await eventSystem.subscribe("*", () => {
        processedCount++;
      });

      perfTracker.recordMemoryBaseline();

      // Run continuous load for multiple cycles
      for (let cycle = 0; cycle < 5; cycle++) {
        mockConnection.startEventGeneration(1000, 2000);

        await new Promise<void>((resolve) => {
          const targetCount = (cycle + 1) * 2000;
          const checkCompletion = () => {
            if (processedCount >= targetCount) {
              resolve();
            } else {
              setTimeout(checkCompletion, 10);
            }
          };
          checkCompletion();
        });

        mockConnection.stopEventGeneration();

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        const memoryGrowth = perfTracker.getMemoryGrowth();
        console.log(`Cycle ${cycle + 1}: Memory growth: ${memoryGrowth.toFixed(2)}MB`);

        // Memory growth should be reasonable
        expect(memoryGrowth).toBeLessThan(PERF_CONFIG.maxMemoryGrowthMb * (cycle + 1) * 2);
      }
    });

    it("should optimize buffer sizes for memory efficiency", async () => {
      const results: Array<{
        bufferSize: number;
        memoryGrowth: number;
        throughput: number;
      }> = [];

      for (const bufferSize of PERF_CONFIG.bufferSizes) {
        const testEventSystem = new HyprlandEventSystem(socketInfo, {
          maxBufferSize: bufferSize,
          eventBatchSize: Math.min(bufferSize / 10, 100),
        });

        const testConnection = new PerformanceMockConnection(socketInfo.path, socketInfo.type, {});
        (testEventSystem as any).connection = testConnection;

        await testEventSystem.connect();

        let processedCount = 0;
        await testEventSystem.subscribe("*", () => {
          processedCount++;
        });

        perfTracker.recordMemoryBaseline();
        const startTime = performance.now();

        testConnection.startEventGeneration(1500, 3000);

        await new Promise<void>((resolve) => {
          const checkCompletion = () => {
            if (processedCount >= 3000) {
              resolve();
            } else {
              setTimeout(checkCompletion, 10);
            }
          };
          checkCompletion();
        });

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;
        const throughput = processedCount / duration;
        const memoryGrowth = perfTracker.getMemoryGrowth();

        results.push({ bufferSize, memoryGrowth, throughput });

        testConnection.stopEventGeneration();
        await testEventSystem.disconnect();
      }

      console.log("Buffer Size Optimization Results:");
      results.forEach(({ bufferSize, memoryGrowth, throughput }) => {
        console.log(
          `  Buffer: ${bufferSize}, Memory: ${memoryGrowth.toFixed(2)}MB, Throughput: ${throughput.toFixed(0)} eps`
        );
      });

      // All configurations should maintain reasonable memory usage
      results.forEach(({ memoryGrowth }) => {
        expect(memoryGrowth).toBeLessThan(PERF_CONFIG.maxMemoryGrowthMb * 3);
      });
    });
  });

  describe("Scalability Testing", () => {
    it("should scale with increasing subscription count", async () => {
      await eventSystem.connect();

      const subscriptionCounts = [1, 5, 10, 25, 50];
      const results: Array<{
        subscriptions: number;
        throughput: number;
        avgLatency: number;
      }> = [];

      for (const subCount of subscriptionCounts) {
        let totalProcessed = 0;
        const latencies: number[] = [];

        // Create subscriptions
        for (let i = 0; i < subCount; i++) {
          await eventSystem.subscribe("activewindow", (event, metadata) => {
            totalProcessed++;
            const latency = performance.now() - metadata.receivedAt;
            latencies.push(latency);
          });
        }

        const startTime = performance.now();
        mockConnection.startEventGeneration(1000, 1000);

        // Wait for processing
        await new Promise<void>((resolve) => {
          const checkCompletion = () => {
            if (totalProcessed >= 1000 * subCount) {
              resolve();
            } else {
              setTimeout(checkCompletion, 10);
            }
          };
          checkCompletion();
        });

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;
        const throughput = 1000 / duration; // Events per second (input rate)
        const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;

        results.push({
          subscriptions: subCount,
          throughput,
          avgLatency,
        });

        mockConnection.stopEventGeneration();

        // Clean up subscriptions for next test
        await eventSystem.disconnect();
        eventSystem = new HyprlandEventSystem(socketInfo, {
          maxBufferSize: 10000,
          eventBatchSize: 100,
        });
        (eventSystem as any).connection = mockConnection;
        await eventSystem.connect();
      }

      console.log("Scalability Test Results:");
      results.forEach(({ subscriptions, throughput, avgLatency }) => {
        console.log(
          `  Subs: ${subscriptions}, Throughput: ${throughput.toFixed(0)} eps, Latency: ${avgLatency.toFixed(3)}ms`
        );
      });

      // Latency should not grow excessively with subscription count
      const baseLatency = results[0].avgLatency;
      const maxLatency = Math.max(...results.map((r) => r.avgLatency));
      expect(maxLatency / baseLatency).toBeLessThan(3); // No more than 3x latency increase
    });

    it("should handle stress test scenarios", async () => {
      await eventSystem.connect();

      let processedCount = 0;
      const errorCount = { value: 0 };

      // Add error tracking
      eventSystem.on("error", () => {
        errorCount.value++;
      });

      await eventSystem.subscribe("*", () => {
        processedCount++;
      });

      perfTracker.recordMemoryBaseline();
      const startTime = performance.now();

      // Generate stress load: 10,000 events as fast as possible
      mockConnection.generateEventBurst(PERF_CONFIG.stressTestEvents);

      // Wait for processing with timeout
      const timeout = 30000; // 30 seconds max
      const startWaitTime = Date.now();

      await new Promise<void>((resolve, reject) => {
        const checkCompletion = () => {
          if (processedCount >= PERF_CONFIG.stressTestEvents) {
            resolve();
          } else if (Date.now() - startWaitTime > timeout) {
            reject(
              new Error(
                `Stress test timeout: processed ${processedCount}/${PERF_CONFIG.stressTestEvents} events`
              )
            );
          } else {
            setTimeout(checkCompletion, 100);
          }
        };
        checkCompletion();
      });

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;
      const throughput = processedCount / duration;
      const memoryGrowth = perfTracker.getMemoryGrowth();
      const stats = eventSystem.getStats();

      console.log(`Stress Test Results:
        Events generated: ${PERF_CONFIG.stressTestEvents}
        Events processed: ${processedCount}
        Duration: ${duration.toFixed(3)}s
        Throughput: ${throughput.toFixed(0)} events/sec
        Memory growth: ${memoryGrowth.toFixed(2)}MB
        Events dropped: ${stats.eventsDropped}
        Errors: ${errorCount.value}
        Buffer utilization: ${stats.bufferUtilization.toFixed(1)}%`);

      // Stress test assertions
      expect(processedCount).toBe(PERF_CONFIG.stressTestEvents);
      expect(errorCount.value).toBe(0);
      expect(memoryGrowth).toBeLessThan(PERF_CONFIG.maxMemoryGrowthMb * 10); // 10x normal events
    });
  });

  describe("Optimization Verification", () => {
    it("should verify batch processing optimization", async () => {
      const results: Array<{
        batchSize: number;
        throughput: number;
        avgLatency: number;
      }> = [];

      for (const batchSize of PERF_CONFIG.batchSizes) {
        const batchEventSystem = new HyprlandEventSystem(socketInfo, {
          eventBatchSize: batchSize,
          maxBufferSize: 10000,
        });

        const batchConnection = new PerformanceMockConnection(socketInfo.path, socketInfo.type, {});
        (batchEventSystem as any).connection = batchConnection;

        await batchEventSystem.connect();

        let processedCount = 0;
        const latencies: number[] = [];

        await batchEventSystem.subscribe("*", (event, metadata) => {
          processedCount++;
          const latency = performance.now() - metadata.receivedAt;
          latencies.push(latency);
        });

        const startTime = performance.now();
        batchConnection.startEventGeneration(2000, 2000);

        await new Promise<void>((resolve) => {
          const checkCompletion = () => {
            if (processedCount >= 2000) {
              resolve();
            } else {
              setTimeout(checkCompletion, 10);
            }
          };
          checkCompletion();
        });

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;
        const throughput = processedCount / duration;
        const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;

        results.push({ batchSize, throughput, avgLatency });

        batchConnection.stopEventGeneration();
        await batchEventSystem.disconnect();
      }

      console.log("Batch Size Optimization Results:");
      results.forEach(({ batchSize, throughput, avgLatency }) => {
        console.log(
          `  Batch: ${batchSize}, Throughput: ${throughput.toFixed(0)} eps, Latency: ${avgLatency.toFixed(3)}ms`
        );
      });

      // Larger batch sizes should generally provide better throughput
      const throughputs = results.map((r) => r.throughput);
      const maxThroughput = Math.max(...throughputs);
      const minThroughput = Math.min(...throughputs);

      // Maximum throughput should be significantly better than minimum
      expect(maxThroughput / minThroughput).toBeGreaterThan(1.2);
    });

    it("should verify deduplication efficiency", async () => {
      await eventSystem.connect();

      let processedCount = 0;
      await eventSystem.subscribe("*", () => {
        processedCount++;
      });

      const uniqueEvents = 100;
      const duplicatesPerEvent = 10;
      const totalEvents = uniqueEvents * duplicatesPerEvent;

      // Generate events with duplicates
      for (let i = 0; i < uniqueEvents; i++) {
        const baseEvent: HyprlandEventData = {
          event: "activewindow",
          data: `dedup-test-${i}`,
        };

        // Send the same event multiple times
        for (let j = 0; j < duplicatesPerEvent; j++) {
          const ipcEvent: IPCEvent = {
            type: "event",
            payload: baseEvent,
            timestamp: Date.now(),
          };
          mockConnection.emit("event", ipcEvent);
        }
      }

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      const stats = eventSystem.getStats();

      console.log(`Deduplication Test Results:
        Events sent: ${totalEvents}
        Events received: ${stats.eventsReceived}
        Events processed: ${processedCount}
        Events deduplicated: ${stats.eventsDeduplicated}
        Deduplication rate: ${((stats.eventsDeduplicated / stats.eventsReceived) * 100).toFixed(1)}%`);

      // Should have deduplicated most events
      expect(stats.eventsDeduplicated).toBeGreaterThan(totalEvents * 0.8);
      expect(processedCount).toBeLessThan(totalEvents * 0.3);
    });
  });
});
