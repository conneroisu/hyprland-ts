/**
 * Concurrency safety utilities for socket communication.
 *
 * This module provides thread-safe primitives and patterns for managing
 * concurrent access to socket connections and shared resources.
 *
 * Key features:
 * - Mutex implementation for critical section protection
 * - Async-safe locks with timeout support
 * - Read-write locks for optimized concurrent access
 * - Semaphore for resource limiting
 * - Rate limiting for backpressure management
 * - Atomic operations for counters and flags
 *
 * @see {@link https://hyprland.org/} - Hyprland window manager
 */

// ============================================================================
// Basic Concurrency Primitives
// ============================================================================

/**
 * A simple mutex implementation for JavaScript/TypeScript.
 * Provides mutual exclusion for critical sections in async code.
 */
export class Mutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * Acquires the mutex lock.
   * If the mutex is already locked, waits until it becomes available.
   *
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves when lock is acquired
   * @throws {Error} When timeout is exceeded
   */
  async acquire(timeout?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
        return;
      }

      const timeoutHandle = timeout
        ? setTimeout(() => {
            const index = this.waitQueue.indexOf(resolveWaiter);
            if (index >= 0) {
              this.waitQueue.splice(index, 1);
              reject(new Error(`Mutex acquisition timeout after ${timeout}ms`));
            }
          }, timeout)
        : null;

      const resolveWaiter = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.locked = true;
        resolve();
      };

      this.waitQueue.push(resolveWaiter);
    });
  }

  /**
   * Releases the mutex lock.
   * Allows the next waiting operation to proceed.
   */
  release(): void {
    if (!this.locked) {
      throw new Error("Cannot release unlocked mutex");
    }

    this.locked = false;

    if (this.waitQueue.length > 0) {
      const nextWaiter = this.waitQueue.shift();
      if (nextWaiter) {
        // Schedule on next tick to avoid stack overflow
        process.nextTick(nextWaiter);
      }
    }
  }

  /**
   * Executes a function with the mutex locked.
   * Automatically handles lock acquisition and release.
   *
   * @param fn - Function to execute under lock
   * @param timeout - Optional lock acquisition timeout
   * @returns Promise that resolves with the function result
   */
  async withLock<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    await this.acquire(timeout);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Checks if the mutex is currently locked.
   *
   * @returns True if locked, false otherwise
   */
  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Read-Write lock implementation for optimized concurrent access.
 * Allows multiple readers or a single writer at a time.
 */
export class ReadWriteLock {
  private readers = 0;
  private writer = false;
  private waitingReaders: Array<() => void> = [];
  private waitingWriters: Array<() => void> = [];

  /**
   * Acquires a read lock.
   * Multiple read locks can be held simultaneously.
   *
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves when read lock is acquired
   */
  async acquireRead(timeout?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.writer && this.waitingWriters.length === 0) {
        this.readers++;
        resolve();
        return;
      }

      const timeoutHandle = timeout
        ? setTimeout(() => {
            const index = this.waitingReaders.indexOf(resolveWaiter);
            if (index >= 0) {
              this.waitingReaders.splice(index, 1);
              reject(new Error(`Read lock acquisition timeout after ${timeout}ms`));
            }
          }, timeout)
        : null;

      const resolveWaiter = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.readers++;
        resolve();
      };

      this.waitingReaders.push(resolveWaiter);
    });
  }

  /**
   * Releases a read lock.
   */
  releaseRead(): void {
    if (this.readers === 0) {
      throw new Error("Cannot release read lock: no active readers");
    }

    this.readers--;

    // If no more readers and there are waiting writers, wake up a writer
    if (this.readers === 0 && this.waitingWriters.length > 0) {
      const nextWriter = this.waitingWriters.shift();
      if (nextWriter) {
        process.nextTick(nextWriter);
      }
    }
  }

  /**
   * Acquires a write lock.
   * Only one write lock can be held at a time.
   *
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves when write lock is acquired
   */
  async acquireWrite(timeout?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.writer && this.readers === 0) {
        this.writer = true;
        resolve();
        return;
      }

      const timeoutHandle = timeout
        ? setTimeout(() => {
            const index = this.waitingWriters.indexOf(resolveWaiter);
            if (index >= 0) {
              this.waitingWriters.splice(index, 1);
              reject(new Error(`Write lock acquisition timeout after ${timeout}ms`));
            }
          }, timeout)
        : null;

      const resolveWaiter = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.writer = true;
        resolve();
      };

      this.waitingWriters.push(resolveWaiter);
    });
  }

  /**
   * Releases a write lock.
   */
  releaseWrite(): void {
    if (!this.writer) {
      throw new Error("Cannot release write lock: no active writer");
    }

    this.writer = false;

    // Prioritize waiting writers over readers
    if (this.waitingWriters.length > 0) {
      const nextWriter = this.waitingWriters.shift();
      if (nextWriter) {
        process.nextTick(nextWriter);
      }
    } else if (this.waitingReaders.length > 0) {
      // Wake up all waiting readers
      const readers = this.waitingReaders.splice(0);
      for (const reader of readers) {
        process.nextTick(reader);
      }
    }
  }

  /**
   * Executes a function with a read lock.
   *
   * @param fn - Function to execute under read lock
   * @param timeout - Optional lock acquisition timeout
   * @returns Promise that resolves with the function result
   */
  async withReadLock<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    await this.acquireRead(timeout);
    try {
      return await fn();
    } finally {
      this.releaseRead();
    }
  }

  /**
   * Executes a function with a write lock.
   *
   * @param fn - Function to execute under write lock
   * @param timeout - Optional lock acquisition timeout
   * @returns Promise that resolves with the function result
   */
  async withWriteLock<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    await this.acquireWrite(timeout);
    try {
      return await fn();
    } finally {
      this.releaseWrite();
    }
  }
}

/**
 * Semaphore implementation for resource limiting.
 * Controls access to a limited number of resources.
 */
export class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  /**
   * Creates a new semaphore with the specified number of permits.
   *
   * @param permits - Number of permits available
   */
  constructor(permits: number) {
    if (permits < 0) {
      throw new Error("Permits must be non-negative");
    }
    this.permits = permits;
  }

  /**
   * Acquires a permit from the semaphore.
   * If no permits are available, waits until one becomes available.
   *
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves when permit is acquired
   */
  async acquire(timeout?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
        return;
      }

      const timeoutHandle = timeout
        ? setTimeout(() => {
            const index = this.waitQueue.indexOf(resolveWaiter);
            if (index >= 0) {
              this.waitQueue.splice(index, 1);
              reject(new Error(`Semaphore acquisition timeout after ${timeout}ms`));
            }
          }, timeout)
        : null;

      const resolveWaiter = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.permits--;
        resolve();
      };

      this.waitQueue.push(resolveWaiter);
    });
  }

  /**
   * Releases a permit back to the semaphore.
   */
  release(): void {
    this.permits++;

    if (this.waitQueue.length > 0) {
      const nextWaiter = this.waitQueue.shift();
      if (nextWaiter) {
        process.nextTick(nextWaiter);
      }
    }
  }

  /**
   * Executes a function with a semaphore permit.
   *
   * @param fn - Function to execute with permit
   * @param timeout - Optional permit acquisition timeout
   * @returns Promise that resolves with the function result
   */
  async withPermit<T>(fn: () => Promise<T>, timeout?: number): Promise<T> {
    await this.acquire(timeout);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Gets the number of available permits.
   *
   * @returns Number of available permits
   */
  availablePermits(): number {
    return this.permits;
  }
}

/**
 * Rate limiter implementation for backpressure management.
 * Controls the rate of operations to prevent overwhelming resources.
 */
export class RateLimiter {
  private readonly capacity: number;
  private readonly refillRate: number;
  private tokens: number;
  private lastRefill: number;
  private waitQueue: Array<{ resolve: () => void; tokens: number }> = [];

  /**
   * Creates a new rate limiter.
   *
   * @param capacity - Maximum number of tokens
   * @param refillRate - Tokens per second to refill
   */
  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Acquires tokens from the rate limiter.
   * If insufficient tokens are available, waits until they are refilled.
   *
   * @param tokens - Number of tokens to acquire (default: 1)
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise that resolves when tokens are acquired
   */
  async acquire(tokens = 1, timeout?: number): Promise<void> {
    if (tokens > this.capacity) {
      throw new Error(`Requested tokens (${tokens}) exceed capacity (${this.capacity})`);
    }

    this.refillTokens();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = timeout
        ? setTimeout(() => {
            const index = this.waitQueue.findIndex((item) => item.resolve === resolve);
            if (index >= 0) {
              this.waitQueue.splice(index, 1);
              reject(new Error(`Rate limiter timeout after ${timeout}ms`));
            }
          }, timeout)
        : null;

      const resolveWaiter = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve();
      };

      this.waitQueue.push({ resolve: resolveWaiter, tokens });
    });
  }

  /**
   * Executes a function with rate limiting.
   *
   * @param fn - Function to execute with rate limiting
   * @param tokens - Number of tokens to consume (default: 1)
   * @param timeout - Optional token acquisition timeout
   * @returns Promise that resolves with the function result
   */
  async withRateLimit<T>(fn: () => Promise<T>, tokens = 1, timeout?: number): Promise<T> {
    await this.acquire(tokens, timeout);
    return fn();
  }

  /**
   * Gets the current number of available tokens.
   *
   * @returns Number of available tokens
   */
  availableTokens(): number {
    this.refillTokens();
    return this.tokens;
  }

  /**
   * Refills tokens based on elapsed time.
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // Convert to seconds
    const tokensToAdd = Math.floor(elapsed * this.refillRate);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;

      // Process waiting requests
      this.processWaitQueue();
    }
  }

  /**
   * Processes the waiting queue for token requests.
   */
  private processWaitQueue(): void {
    while (this.waitQueue.length > 0) {
      const next = this.waitQueue[0];
      if (next && this.tokens >= next.tokens) {
        this.tokens -= next.tokens;
        this.waitQueue.shift();
        process.nextTick(next.resolve);
      } else {
        break;
      }
    }
  }

  /**
   * Gets the maximum token capacity.
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Gets the token refill rate per second.
   */
  getRefillRate(): number {
    return this.refillRate;
  }
}

/**
 * Atomic counter for thread-safe counting operations.
 */
export class AtomicCounter {
  private value = 0;
  private readonly mutex = new Mutex();

  /**
   * Creates a new atomic counter.
   *
   * @param initialValue - Initial counter value (default: 0)
   */
  constructor(initialValue = 0) {
    this.value = initialValue;
  }

  /**
   * Atomically increments the counter.
   *
   * @param delta - Amount to increment (default: 1)
   * @returns Promise that resolves with the new value
   */
  async increment(delta = 1): Promise<number> {
    return this.mutex.withLock(async () => {
      this.value += delta;
      return this.value;
    });
  }

  /**
   * Atomically decrements the counter.
   *
   * @param delta - Amount to decrement (default: 1)
   * @returns Promise that resolves with the new value
   */
  async decrement(delta = 1): Promise<number> {
    return this.mutex.withLock(async () => {
      this.value -= delta;
      return this.value;
    });
  }

  /**
   * Atomically gets the current value.
   *
   * @returns Promise that resolves with the current value
   */
  async get(): Promise<number> {
    return this.mutex.withLock(async () => {
      return this.value;
    });
  }

  /**
   * Atomically sets the value.
   *
   * @param newValue - New value to set
   * @returns Promise that resolves with the new value
   */
  async set(newValue: number): Promise<number> {
    return this.mutex.withLock(async () => {
      this.value = newValue;
      return this.value;
    });
  }

  /**
   * Atomically compares and swaps the value.
   *
   * @param expected - Expected current value
   * @param newValue - New value to set if current matches expected
   * @returns Promise that resolves with true if swap occurred, false otherwise
   */
  async compareAndSwap(expected: number, newValue: number): Promise<boolean> {
    return this.mutex.withLock(async () => {
      if (this.value === expected) {
        this.value = newValue;
        return true;
      }
      return false;
    });
  }
}

/**
 * Atomic boolean flag for thread-safe boolean operations.
 */
export class AtomicBoolean {
  private value = false;
  private readonly mutex = new Mutex();

  /**
   * Creates a new atomic boolean.
   *
   * @param initialValue - Initial boolean value (default: false)
   */
  constructor(initialValue = false) {
    this.value = initialValue;
  }

  /**
   * Atomically gets the current value.
   *
   * @returns Promise that resolves with the current value
   */
  async get(): Promise<boolean> {
    return this.mutex.withLock(async () => {
      return this.value;
    });
  }

  /**
   * Atomically sets the value.
   *
   * @param newValue - New value to set
   * @returns Promise that resolves with the new value
   */
  async set(newValue: boolean): Promise<boolean> {
    return this.mutex.withLock(async () => {
      this.value = newValue;
      return this.value;
    });
  }

  /**
   * Atomically compares and swaps the value.
   *
   * @param expected - Expected current value
   * @param newValue - New value to set if current matches expected
   * @returns Promise that resolves with true if swap occurred, false otherwise
   */
  async compareAndSwap(expected: boolean, newValue: boolean): Promise<boolean> {
    return this.mutex.withLock(async () => {
      if (this.value === expected) {
        this.value = newValue;
        return true;
      }
      return false;
    });
  }

  /**
   * Atomically toggles the value.
   *
   * @returns Promise that resolves with the new value
   */
  async toggle(): Promise<boolean> {
    return this.mutex.withLock(async () => {
      this.value = !this.value;
      return this.value;
    });
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Executes multiple async functions with controlled concurrency.
 *
 * @param tasks - Array of async functions to execute
 * @param concurrency - Maximum number of concurrent executions
 * @returns Promise that resolves with array of results
 */
export async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const semaphore = new Semaphore(concurrency);
  const results: T[] = [];

  const wrappedTasks = tasks.map((task, index) =>
    semaphore.withPermit(async () => {
      const result = await task();
      results[index] = result;
      return result;
    })
  );

  await Promise.all(wrappedTasks);
  return results;
}

/**
 * Creates a debounced version of an async function.
 * Prevents multiple rapid calls by delaying execution.
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  delay: number
): (...args: T) => Promise<R> {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingResolve: ((value: R) => void) | null = null;
  let pendingReject: ((error: unknown) => void) | null = null;

  return (...args: T): Promise<R> => {
    return new Promise((resolve, reject) => {
      // Cancel previous timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Store the resolve/reject for the current call
      pendingResolve = resolve;
      pendingReject = reject;

      // Set new timeout
      timeoutId = setTimeout(async () => {
        try {
          const result = await fn(...args);
          pendingResolve?.(result);
        } catch (error) {
          pendingReject?.(error);
        } finally {
          timeoutId = null;
          pendingResolve = null;
          pendingReject = null;
        }
      }, delay);
    });
  };
}

/**
 * Creates a throttled version of an async function.
 * Limits the rate of function execution.
 *
 * @param fn - Function to throttle
 * @param interval - Minimum interval between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  interval: number
): (...args: T) => Promise<R> {
  let lastCall = 0;
  let pendingCall: NodeJS.Timeout | null = null;

  return (...args: T): Promise<R> => {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCall;

      if (timeSinceLastCall >= interval) {
        // Execute immediately
        lastCall = now;
        fn(...args)
          .then(resolve)
          .catch(reject);
      } else {
        // Schedule for later
        if (pendingCall) {
          clearTimeout(pendingCall);
        }

        const delay = interval - timeSinceLastCall;
        pendingCall = setTimeout(() => {
          lastCall = Date.now();
          pendingCall = null;
          fn(...args)
            .then(resolve)
            .catch(reject);
        }, delay);
      }
    });
  };
}
