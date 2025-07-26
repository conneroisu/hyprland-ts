/**
 * Core type definitions for Hyprland window manager IPC interface
 * Based on Hyprland v0.45+ API specification
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface HyprlandConfig {
  readonly socketPath: string;
  readonly timeout?: number;
}

// ============================================================================
// Window/Client Types
// ============================================================================

/** Position and size coordinates */
export interface HyprlandPosition {
  readonly x: number;
  readonly y: number;
}

export interface HyprlandSize {
  readonly width: number;
  readonly height: number;
}

/** Window/Client object as returned by hyprctl clients -j */
export interface HyprlandWindow {
  /** Unique window address identifier */
  readonly address: string;
  /** Whether the window is currently mapped */
  readonly mapped: boolean;
  /** Whether the window is hidden */
  readonly hidden: boolean;
  /** Window position [x, y] */
  readonly at: readonly [number, number];
  /** Window size [width, height] */
  readonly size: readonly [number, number];
  /** Workspace information */
  readonly workspace: HyprlandWorkspaceInfo;
  /** Whether the window is floating */
  readonly floating: boolean;
  /** Monitor ID the window is on */
  readonly monitor: number;
  /** Application class name */
  readonly class: string;
  /** Window title */
  readonly title: string;
  /** Process ID */
  readonly pid: number;
  /** Whether running under Xwayland */
  readonly xwayland: boolean;
  /** Whether the window is pinned */
  readonly pinned: boolean;
  /** Whether the window is fullscreen */
  readonly fullscreen: boolean;
  /** Fullscreen mode (0=none, 1=client, 2=fullscreen) */
  readonly fullscreenMode: number;
  /** Whether the window has focus */
  readonly focusHistoryID: number;
}

// ============================================================================
// Workspace Types
// ============================================================================

/** Simplified workspace info for window references */
export interface HyprlandWorkspaceInfo {
  readonly id: number;
  readonly name: string;
}

/** Complete workspace object as returned by hyprctl workspaces -j */
export interface HyprlandWorkspace {
  /** Workspace ID */
  readonly id: number;
  /** Workspace name */
  readonly name: string;
  /** Monitor the workspace is on */
  readonly monitor: string;
  /** Monitor ID */
  readonly monitorID: number;
  /** Number of windows in workspace */
  readonly windows: number;
  /** Whether workspace has a fullscreen window */
  readonly hasfullscreen: boolean;
  /** Address of last focused window */
  readonly lastwindow: string;
  /** Title of last focused window */
  readonly lastwindowtitle: string;
}

// ============================================================================
// Monitor Types
// ============================================================================

/** Monitor object as returned by hyprctl monitors -j */
export interface HyprlandMonitor {
  /** Monitor ID */
  readonly id: number;
  /** Monitor name (e.g., DP-1, HDMI-A-1) */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** Manufacturer name */
  readonly make: string;
  /** Model name */
  readonly model: string;
  /** Serial number */
  readonly serial: string;
  /** Monitor width in pixels */
  readonly width: number;
  /** Monitor height in pixels */
  readonly height: number;
  /** Refresh rate in Hz */
  readonly refreshRate: number;
  /** X position in layout */
  readonly x: number;
  /** Y position in layout */
  readonly y: number;
  /** Currently active workspace */
  readonly activeWorkspace: HyprlandWorkspaceInfo;
  /** Special workspace info */
  readonly specialWorkspace: HyprlandWorkspaceInfo;
  /** Reserved area [top, right, bottom, left] */
  readonly reserved: readonly [number, number, number, number];
  /** Display scale factor */
  readonly scale: number;
  /** Display transform */
  readonly transform: number;
  /** Whether monitor is focused */
  readonly focused: boolean;
  /** DPMS status */
  readonly dpmsStatus: boolean;
  /** Variable refresh rate enabled */
  readonly vrr: boolean;
  /** Available modes */
  readonly availableModes: readonly string[];
}

// ============================================================================
// Event Types
// ============================================================================

/** Base event interface */
export interface HyprlandEventData {
  readonly event: string;
  readonly data: unknown;
}

/** Specific event types */
export interface HyprlandWindowEvent extends HyprlandEventData {
  readonly event:
    | "activewindow"
    | "activewindowv2"
    | "openwindow"
    | "closewindow"
    | "movewindow"
    | "movewindowv2";
  readonly data: string;
}

export interface HyprlandWorkspaceEvent extends HyprlandEventData {
  readonly event:
    | "workspace"
    | "workspacev2"
    | "createworkspace"
    | "createworkspacev2"
    | "destroyworkspace"
    | "destroyworkspacev2"
    | "moveworkspace"
    | "moveworkspacev2";
  readonly data: string;
}

export interface HyprlandMonitorEvent extends HyprlandEventData {
  readonly event: "monitoradded" | "monitorremoved" | "focusedmon";
  readonly data: string;
}

export interface HyprlandLayoutEvent extends HyprlandEventData {
  readonly event: "changefloatingmode" | "fullscreen";
  readonly data: string;
}

export interface HyprlandKeyboardEvent extends HyprlandEventData {
  readonly event: "activelayout";
  readonly data: string;
}

export interface HyprlandUrgentEvent extends HyprlandEventData {
  readonly event: "urgent";
  readonly data: string;
}

export interface HyprlandSubmapEvent extends HyprlandEventData {
  readonly event: "submap";
  readonly data: string;
}

/** Union of all event types */
export type HyprlandEvent =
  | HyprlandWindowEvent
  | HyprlandWorkspaceEvent
  | HyprlandMonitorEvent
  | HyprlandLayoutEvent
  | HyprlandKeyboardEvent
  | HyprlandUrgentEvent
  | HyprlandSubmapEvent;

// ============================================================================
// HyprCtl Command Types
// ============================================================================

/** Available hyprctl commands */
export type HyprCtlCommand =
  | "clients"
  | "workspaces"
  | "monitors"
  | "devices"
  | "layers"
  | "splash"
  | "getoption"
  | "cursorpos"
  | "animations"
  | "instances"
  | "layouts"
  | "configerrors"
  | "rollinglog"
  | "globalshortcuts"
  | "binds"
  | "activewindow"
  | "activeworkspace";

/** HyprCtl dispatch commands */
export type HyprCtlDispatchCommand =
  | "exec"
  | "killactive"
  | "closewindow"
  | "workspace"
  | "movetoworkspace"
  | "movetoworkspacesilent"
  | "togglefloating"
  | "fullscreen"
  | "fakefullscreen"
  | "movefocus"
  | "movewindow"
  | "resizewindow"
  | "centerwindow"
  | "focuswindow"
  | "focusmonitor"
  | "movecurrentworkspacetomonitor"
  | "moveworkspacetomonitor"
  | "togglespecialworkspace"
  | "movetoworkspace"
  | "pin"
  | "splitratio"
  | "toggleopaque"
  | "movecursortocorner"
  | "workspaceopt"
  | "exit";

/** HyprCtl request structure */
export interface HyprCtlRequest {
  readonly command: HyprCtlCommand | "dispatch";
  readonly args?: readonly string[];
  readonly dispatchCommand?: HyprCtlDispatchCommand;
  readonly json?: boolean;
}

/** HyprCtl response structure */
export interface HyprCtlResponse<T = unknown> {
  readonly success: boolean;
  readonly data: T | undefined;
  readonly error: string | undefined;
}

// ============================================================================
// IPC Protocol Types
// ============================================================================

/** IPC socket types */
export type SocketType = "command" | "event";

/** IPC message structure */
export interface IPCMessage {
  readonly type: "request" | "response" | "event";
  readonly payload: unknown;
  readonly timestamp?: number;
}

/** IPC request message */
export interface IPCRequest extends IPCMessage {
  readonly type: "request";
  readonly payload: HyprCtlRequest;
  readonly id?: string;
}

/** IPC response message */
export interface IPCResponse extends IPCMessage {
  readonly type: "response";
  readonly payload: HyprCtlResponse;
  readonly id?: string;
}

/** IPC event message */
export interface IPCEvent extends IPCMessage {
  readonly type: "event";
  readonly payload: HyprlandEvent;
}

// ============================================================================
// Configuration Schema Types
// ============================================================================

/** Hyprland configuration option value types */
export type ConfigValue = string | number | boolean | readonly string[];

/** Configuration option definition */
export interface ConfigOption {
  readonly name: string;
  readonly value: ConfigValue;
  readonly description?: string;
  readonly defaultValue?: ConfigValue;
}

/** Configuration section */
export interface ConfigSection {
  readonly name: string;
  readonly options: readonly ConfigOption[];
  readonly subsections?: readonly ConfigSection[];
}

// ============================================================================
// Utility Types
// ============================================================================

/** Version compatibility annotation */
export interface VersionInfo {
  readonly minVersion: string;
  readonly maxVersion?: string;
  readonly deprecated?: boolean;
  readonly deprecationMessage?: string;
}

/** Type with version information */
export interface VersionedType<T> {
  readonly data: T;
  readonly version: VersionInfo;
}

// ============================================================================
// Error Types
// ============================================================================

/** Hyprland-specific error types */
export interface HyprlandError extends Error {
  readonly code: string;
  readonly details?: unknown;
}

/** IPC connection errors */
export interface IPCError extends HyprlandError {
  readonly socketType: SocketType;
  readonly socketPath: string;
}

/** Command execution errors */
export interface CommandError extends HyprlandError {
  readonly command: string;
  readonly args?: readonly string[];
}

// ============================================================================
// Type Guards and Validation
// ============================================================================

/** Runtime type validation result */
export interface ValidationResult<T = unknown> {
  readonly success: boolean;
  readonly data: T | undefined;
  readonly errors: readonly string[] | undefined;
}

/** Type predicate function */
export type TypePredicate<T> = (value: unknown) => value is T;

/** Type validator function */
export type TypeValidator<T> = (value: unknown) => ValidationResult<T>;
