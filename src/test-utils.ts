/**
 * Test utilities and fixtures for comprehensive testing
 * Provides realistic test data and helper functions
 */

import type {
  HyprCtlCommand,
  HyprCtlRequest,
  HyprCtlResponse,
  HyprlandEvent,
  HyprlandMonitor,
  HyprlandWindow,
  HyprlandWorkspace,
  HyprlandWorkspaceInfo,
} from "./types.js";

// ============================================================================
// Test Data Generators
// ============================================================================

/** Generate a realistic workspace info object */
export function createMockWorkspaceInfo(
  overrides: Partial<HyprlandWorkspaceInfo> = {}
): HyprlandWorkspaceInfo {
  return {
    id: 1,
    name: "1",
    ...overrides,
  };
}

/** Generate a realistic window object */
export function createMockWindow(overrides: Partial<HyprlandWindow> = {}): HyprlandWindow {
  return {
    address: "0x5649a1b4f380",
    mapped: true,
    hidden: false,
    at: [1920, 25] as const,
    size: [1878, 1055] as const,
    workspace: createMockWorkspaceInfo(),
    floating: false,
    monitor: 0,
    class: "firefox",
    title: "Mozilla Firefox",
    pid: 12345,
    xwayland: false,
    pinned: false,
    fullscreen: false,
    fullscreenMode: 0,
    focusHistoryID: 0,
    ...overrides,
  };
}

/** Generate a realistic workspace object */
export function createMockWorkspace(overrides: Partial<HyprlandWorkspace> = {}): HyprlandWorkspace {
  return {
    id: 1,
    name: "1",
    monitor: "DP-1",
    monitorID: 0,
    windows: 3,
    hasfullscreen: false,
    lastwindow: "0x5649a1b4f380",
    lastwindowtitle: "Mozilla Firefox",
    ...overrides,
  };
}

/** Generate a realistic monitor object */
export function createMockMonitor(overrides: Partial<HyprlandMonitor> = {}): HyprlandMonitor {
  return {
    id: 0,
    name: "DP-1",
    description: "Dell Inc. DELL U2720Q 123456789",
    make: "Dell Inc.",
    model: "DELL U2720Q",
    serial: "123456789",
    width: 3840,
    height: 2160,
    refreshRate: 60.0,
    x: 0,
    y: 0,
    activeWorkspace: createMockWorkspaceInfo(),
    specialWorkspace: createMockWorkspaceInfo({ id: -1, name: "special:special" }),
    reserved: [0, 0, 0, 0] as const,
    scale: 1.5,
    transform: 0,
    focused: true,
    dpmsStatus: true,
    vrr: false,
    availableModes: ["3840x2160@60", "3840x2160@30", "1920x1080@60"],
    ...overrides,
  };
}

// ============================================================================
// Complex Test Scenarios
// ============================================================================

/** Generate multiple related windows for integration testing */
export function createWindowCluster(count = 3): HyprlandWindow[] {
  return Array.from({ length: count }, (_, i) =>
    createMockWindow({
      address: `0x${(0x5649a1b4f380 + i).toString(16)}`,
      title: `Window ${i + 1}`,
      pid: 12345 + i,
      at: [100 + i * 50, 100 + i * 50] as const,
      size: [800, 600] as const,
      workspace: createMockWorkspaceInfo({ id: Math.floor(i / 2) + 1 }),
      focusHistoryID: i,
    })
  );
}

/** Generate multiple workspaces for testing */
export function createWorkspaceSet(count = 5): HyprlandWorkspace[] {
  return Array.from({ length: count }, (_, i) =>
    createMockWorkspace({
      id: i + 1,
      name: `${i + 1}`,
      windows: Math.floor(Math.random() * 5),
      hasfullscreen: i === 2, // Third workspace has fullscreen
      monitorID: i < 3 ? 0 : 1, // First 3 on monitor 0, rest on monitor 1
    })
  );
}

/** Generate multi-monitor setup */
export function createMonitorSetup(): HyprlandMonitor[] {
  return [
    createMockMonitor({
      id: 0,
      name: "DP-1",
      width: 3840,
      height: 2160,
      x: 0,
      y: 0,
      focused: true,
      activeWorkspace: createMockWorkspaceInfo({ id: 1 }),
    }),
    createMockMonitor({
      id: 1,
      name: "HDMI-A-1",
      width: 1920,
      height: 1080,
      x: 3840,
      y: 540,
      focused: false,
      scale: 1.0,
      activeWorkspace: createMockWorkspaceInfo({ id: 4 }),
    }),
  ];
}

// ============================================================================
// Event Test Data
// ============================================================================

/** Generate realistic event data */
export function createMockEvent(
  eventType: HyprlandEvent["event"] = "activewindow",
  data = "0x5649a1b4f380,Mozilla Firefox"
): HyprlandEvent {
  return {
    event: eventType,
    data,
  };
}

/** Generate a sequence of events for testing event handling */
export function createEventSequence(): HyprlandEvent[] {
  return [
    createMockEvent("workspace", "2"),
    createMockEvent("activewindow", "0x5649a1b4f380,Mozilla Firefox"),
    createMockEvent("openwindow", "0x5649a1b4f381,class:code,title:VS Code"),
    createMockEvent("focusedmon", "DP-1,2"),
    createMockEvent("closewindow", "0x5649a1b4f380"),
  ];
}

// ============================================================================
// IPC Mock Data
// ============================================================================

/** Generate realistic HyprCtl request */
export function createMockHyprCtlRequest(
  command: HyprCtlCommand = "clients",
  args: string[] = [],
  json = true
): HyprCtlRequest {
  return {
    command: command,
    args,
    json,
  };
}

/** Generate realistic HyprCtl response */
export function createMockHyprCtlResponse<T>(data: T, success = true): HyprCtlResponse<T> {
  if (success) {
    return {
      success: true,
      data,
      error: undefined,
    };
  }
  return {
    success: false,
    data: undefined,
    error: "Mock error message",
  } as HyprCtlResponse<T>;
}

// ============================================================================\n// Edge Cases and Error Scenarios\n// ============================================================================\n\n/** Generate invalid window data for error testing */\nexport function createInvalidWindowData(): Record<string, unknown>[] {\n  return [\n    {}, // Empty object\n    { address: 'invalid' }, // Missing required fields\n    { \n      address: '0x123',\n      mapped: 'not a boolean', // Wrong type\n      at: [100], // Wrong array length\n    },\n    {\n      address: '0x123',\n      mapped: true,\n      hidden: false,\n      at: [100, 200],\n      size: [800, 600],\n      workspace: { invalid: 'workspace' }, // Invalid workspace\n      floating: false,\n      monitor: 'not a number', // Wrong type\n      class: 'test',\n      title: 'test',\n      pid: 'not a number', // Wrong type\n      xwayland: false,\n      pinned: false,\n      fullscreen: false,\n      fullscreenMode: 0,\n      focusHistoryID: 0,\n    },\n    null, // Null value\n    'string', // Wrong type entirely\n    [], // Array instead of object\n  ];\n}\n\n/** Generate edge case window configurations */\nexport function createEdgeCaseWindows(): HyprlandWindow[] {\n  return [\n    // Floating window\n    createMockWindow({\n      floating: true,\n      at: [100, 100] as const,\n      size: [400, 300] as const,\n    }),\n    // Fullscreen window\n    createMockWindow({\n      fullscreen: true,\n      fullscreenMode: 1,\n      at: [0, 0] as const,\n      size: [3840, 2160] as const,\n    }),\n    // Hidden window\n    createMockWindow({\n      hidden: true,\n      mapped: false,\n    }),\n    // Xwayland window\n    createMockWindow({\n      xwayland: true,\n      class: 'legacy-app',\n      title: 'Legacy X11 Application',\n    }),\n    // Pinned window\n    createMockWindow({\n      pinned: true,\n      floating: true,\n      at: [50, 50] as const,\n      size: [200, 150] as const,\n    }),\n    // Special workspace window\n    createMockWindow({\n      workspace: createMockWorkspaceInfo({ id: -99, name: 'special:scratchpad' }),\n    }),\n  ];\n}\n\n/** Generate performance test data */\nexport function createLargeDataset(size: number): {\n  windows: HyprlandWindow[];\n  workspaces: HyprlandWorkspace[];\n  monitors: HyprlandMonitor[];\n} {\n  const windows = Array.from({ length: size }, (_, i) =>\n    createMockWindow({\n      address: `0x${i.toString(16).padStart(8, '0')}`,\n      title: `Window ${i}`,\n      pid: 1000 + i,\n      workspace: createMockWorkspaceInfo({ id: (i % 10) + 1 }),\n    })\n  );\n  \n  const workspaces = Array.from({ length: Math.min(size / 10, 20) }, (_, i) =>\n    createMockWorkspace({\n      id: i + 1,\n      name: `workspace-${i + 1}`,\n      windows: Math.floor(size / 20),\n    })\n  );\n  \n  const monitors = Array.from({ length: Math.min(size / 100, 5) }, (_, i) =>\n    createMockMonitor({\n      id: i,\n      name: `MONITOR-${i}`,\n      activeWorkspace: createMockWorkspaceInfo({ id: i + 1 }),\n    })\n  );\n  \n  return { windows, workspaces, monitors };\n}\n\n// ============================================================================\n// Test Assertion Helpers\n// ============================================================================\n\n/** Assert that a window has valid structure */\nexport function assertValidWindow(window: unknown): asserts window is HyprlandWindow {\n  if (typeof window !== 'object' || window === null) {\n    throw new Error('Window must be an object');\n  }\n  \n  const w = window as Record<string, unknown>;\n  \n  if (typeof w.address !== 'string') {\n    throw new Error('Window address must be a string');\n  }\n  \n  if (typeof w.mapped !== 'boolean') {\n    throw new Error('Window mapped must be a boolean');\n  }\n  \n  if (!Array.isArray(w.at) || w.at.length !== 2) {\n    throw new Error('Window at must be an array of 2 numbers');\n  }\n}\n\n/** Check if two windows are equivalent for testing */\nexport function windowsEqual(a: HyprlandWindow, b: HyprlandWindow): boolean {\n  return (\n    a.address === b.address &&\n    a.mapped === b.mapped &&\n    a.hidden === b.hidden &&\n    a.at[0] === b.at[0] &&\n    a.at[1] === b.at[1] &&\n    a.size[0] === b.size[0] &&\n    a.size[1] === b.size[1] &&\n    a.workspace.id === b.workspace.id &&\n    a.workspace.name === b.workspace.name &&\n    a.floating === b.floating &&\n    a.monitor === b.monitor &&\n    a.class === b.class &&\n    a.title === b.title &&\n    a.pid === b.pid &&\n    a.xwayland === b.xwayland &&\n    a.pinned === b.pinned &&\n    a.fullscreen === b.fullscreen &&\n    a.fullscreenMode === b.fullscreenMode &&\n    a.focusHistoryID === b.focusHistoryID\n  );\n}\n\n// ============================================================================\n// Mock IPC Functions\n// ============================================================================\n\n/** Mock socket connection for testing */\nexport class MockSocket {\n  private listeners: Map<string, ((data: string) => void)[]> = new Map();\n  private connected = false;\n  \n  connect(): Promise<void> {\n    return new Promise((resolve) => {\n      setTimeout(() => {\n        this.connected = true;\n        resolve();\n      }, 10);\n    });\n  }\n  \n  disconnect(): void {\n    this.connected = false;\n    this.listeners.clear();\n  }\n  \n  send(data: string): Promise<string> {\n    if (!this.connected) {\n      throw new Error('Socket not connected');\n    }\n    \n    // Simulate processing delay\n    return new Promise((resolve) => {\n      setTimeout(() => {\n        resolve(`Response to: ${data}`);\n      }, 5);\n    });\n  }\n  \n  on(event: string, callback: (data: string) => void): void {\n    if (!this.listeners.has(event)) {\n      this.listeners.set(event, []);\n    }\n    this.listeners.get(event)!.push(callback);\n  }\n  \n  emit(event: string, data: string): void {\n    const callbacks = this.listeners.get(event) || [];\n    callbacks.forEach(callback => callback(data));\n  }\n  \n  isConnected(): boolean {\n    return this.connected;\n  }\n}\n\n/** Create a mock socket for testing */\nexport function createMockSocket(): MockSocket {\n  return new MockSocket();\n}"
