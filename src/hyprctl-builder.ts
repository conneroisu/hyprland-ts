/**
 * Type-safe Command Builder for HyprCtl
 *
 * This module provides a fluent, type-safe interface for building HyprCtl commands
 * with full autocompletion support and compile-time validation.
 *
 * Key features:
 * - Fluent API with method chaining
 * - Full TypeScript autocompletion
 * - Compile-time command validation
 * - Parameter type checking
 * - Built-in command documentation
 * - Support for all HyprCtl commands and dispatch operations
 */

import type { CommandOptions, CommandResult, HyprCtlClient } from "./hyprctl-client.js";
import type {
  HyprCtlCommand,
  HyprCtlDispatchCommand,
  HyprlandMonitor,
  HyprlandWindow,
  HyprlandWorkspace,
} from "./types.js";

// ============================================================================
// Command Parameter Types
// ============================================================================

/**
 * Window selector types for various commands.
 */
export type WindowSelector =
  | { type: "address"; value: string }
  | { type: "pid"; value: number }
  | { type: "class"; value: string }
  | { type: "title"; value: string };

/**
 * Workspace selector types.
 */
export type WorkspaceSelector = { type: "id"; value: number } | { type: "name"; value: string };

/**
 * Monitor selector types.
 */
export type MonitorSelector = { type: "id"; value: number } | { type: "name"; value: string };

/**
 * Direction types for window movement and focus.
 */
export type Direction = "left" | "right" | "up" | "down";

/**
 * Resize direction types.
 */
export type ResizeDirection = "left" | "right" | "up" | "down";

/**
 * Fullscreen mode types.
 */
export type FullscreenMode = 0 | 1 | 2;

// ============================================================================
// Command Builder Base Classes
// ============================================================================

/**
 * Base class for command builders.
 */
abstract class BaseCommandBuilder<T = unknown> {
  protected client: HyprCtlClient;
  protected options: CommandOptions = {};

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Set command options.
   */
  withOptions(options: CommandOptions): this {
    this.options = { ...this.options, ...options };
    return this;
  }

  /**
   * Request JSON response format.
   */
  asJson(json = true): this {
    this.options = { ...this.options, json };
    return this;
  }

  /**
   * Set command timeout.
   */
  withTimeout(timeout: number): this {
    this.options = { ...this.options, timeout };
    return this;
  }

  /**
   * Skip cache for this command.
   */
  skipCache(): this {
    this.options = { ...this.options, skipCache: true };
    return this;
  }

  /**
   * Set command priority.
   */
  withPriority(priority: "low" | "normal" | "high"): this {
    this.options = { ...this.options, priority };
    return this;
  }

  /**
   * Set execution context for debugging.
   */
  withContext(context: string): this {
    this.options = { ...this.options, context };
    return this;
  }

  /**
   * Execute the built command.
   */
  abstract execute(): Promise<CommandResult<T>>;
}

/**
 * Query command builder for information retrieval commands.
 */
class QueryCommandBuilder<T> extends BaseCommandBuilder<T> {
  private readonly command: HyprCtlCommand;
  private readonly args: readonly string[];

  constructor(client: HyprCtlClient, command: HyprCtlCommand, args: readonly string[] = []) {
    super(client);
    this.command = command;
    this.args = args;
  }

  async execute(): Promise<CommandResult<T>> {
    return this.client.executeCommand<T>(this.command, this.args, this.options);
  }
}

/**
 * Dispatch command builder for window management operations.
 */
class DispatchCommandBuilder<T = void> extends BaseCommandBuilder<T> {
  private readonly dispatchCommand: HyprCtlDispatchCommand;
  private readonly args: readonly string[];

  constructor(
    client: HyprCtlClient,
    dispatchCommand: HyprCtlDispatchCommand,
    args: readonly string[] = []
  ) {
    super(client);
    this.dispatchCommand = dispatchCommand;
    this.args = args;
  }

  async execute(): Promise<CommandResult<T>> {
    return this.client.executeDispatch<T>(this.dispatchCommand, this.args, this.options);
  }
}

// ============================================================================
// Specialized Command Builders
// ============================================================================

/**
 * Window management command builder.
 */
export class WindowCommandBuilder {
  private readonly client: HyprCtlClient;

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Get list of all windows.
   */
  list(): QueryCommandBuilder<HyprlandWindow[]> {
    return new QueryCommandBuilder<HyprlandWindow[]>(this.client, "clients");
  }

  /**
   * Close the active window.
   */
  closeActive(): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "killactive");
  }

  /**
   * Close a specific window.
   */
  close(selector: WindowSelector): DispatchCommandBuilder {
    const arg = this.formatWindowSelector(selector);
    return new DispatchCommandBuilder(this.client, "closewindow", [arg]);
  }

  /**
   * Focus a window.
   */
  focus(selector: WindowSelector): DispatchCommandBuilder {
    const arg = this.formatWindowSelector(selector);
    return new DispatchCommandBuilder(this.client, "focuswindow", [arg]);
  }

  /**
   * Move focus in a direction.
   */
  moveFocus(direction: Direction): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "movefocus", [direction]);
  }

  /**
   * Move window in a direction.
   */
  moveWindow(direction: Direction): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "movewindow", [direction]);
  }

  /**
   * Resize window.
   */
  resize(direction: ResizeDirection, amount: number): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "resizewindow", [direction, String(amount)]);
  }

  /**
   * Toggle window floating state.
   */
  toggleFloating(): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "togglefloating");
  }

  /**
   * Set window to fullscreen.
   */
  fullscreen(mode: FullscreenMode = 1): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "fullscreen", [String(mode)]);
  }

  /**
   * Toggle fake fullscreen.
   */
  fakeFullscreen(): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "fakefullscreen");
  }

  /**
   * Center window.
   */
  center(): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "centerwindow");
  }

  /**
   * Move window to workspace.
   */
  moveToWorkspace(workspace: WorkspaceSelector): DispatchCommandBuilder {
    const arg = this.formatWorkspaceSelector(workspace);
    return new DispatchCommandBuilder(this.client, "movetoworkspace", [arg]);
  }

  /**
   * Move window to workspace silently.
   */
  moveToWorkspaceSilent(workspace: WorkspaceSelector): DispatchCommandBuilder {
    const arg = this.formatWorkspaceSelector(workspace);
    return new DispatchCommandBuilder(this.client, "movetoworkspacesilent", [arg]);
  }

  private formatWindowSelector(selector: WindowSelector): string {
    switch (selector.type) {
      case "address":
        return `address:${selector.value}`;
      case "pid":
        return `pid:${selector.value}`;
      case "class":
        return `class:${selector.value}`;
      case "title":
        return `title:${selector.value}`;
      default:
        throw new Error(`Unknown window selector type: ${(selector as { type: string }).type}`);
    }
  }

  private formatWorkspaceSelector(selector: WorkspaceSelector): string {
    switch (selector.type) {
      case "id":
        return String(selector.value);
      case "name":
        return selector.value;
      default:
        throw new Error(`Unknown workspace selector type: ${(selector as { type: string }).type}`);
    }
  }
}

/**
 * Workspace management command builder.
 */
export class WorkspaceCommandBuilder {
  private readonly client: HyprCtlClient;

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Get list of all workspaces.
   */
  list(): QueryCommandBuilder<HyprlandWorkspace[]> {
    return new QueryCommandBuilder<HyprlandWorkspace[]>(this.client, "workspaces");
  }

  /**
   * Switch to workspace.
   */
  switch(selector: WorkspaceSelector): DispatchCommandBuilder {
    const arg = this.formatWorkspaceSelector(selector);
    return new DispatchCommandBuilder(this.client, "workspace", [arg]);
  }

  /**
   * Create and switch to workspace.
   */
  create(id: number): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "workspace", [String(id)]);
  }

  private formatWorkspaceSelector(selector: WorkspaceSelector): string {
    switch (selector.type) {
      case "id":
        return String(selector.value);
      case "name":
        return selector.value;
      default:
        throw new Error(`Unknown workspace selector type: ${(selector as { type: string }).type}`);
    }
  }
}

/**
 * Monitor management command builder.
 */
export class MonitorCommandBuilder {
  private readonly client: HyprCtlClient;

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Get list of all monitors.
   */
  list(): QueryCommandBuilder<HyprlandMonitor[]> {
    return new QueryCommandBuilder<HyprlandMonitor[]>(this.client, "monitors");
  }

  /**
   * Focus monitor.
   */
  focus(selector: MonitorSelector): DispatchCommandBuilder {
    const arg = this.formatMonitorSelector(selector);
    return new DispatchCommandBuilder(this.client, "focusmonitor", [arg]);
  }

  private formatMonitorSelector(selector: MonitorSelector): string {
    switch (selector.type) {
      case "id":
        return String(selector.value);
      case "name":
        return selector.value;
      default:
        throw new Error(`Unknown monitor selector type: ${(selector as { type: string }).type}`);
    }
  }
}

/**
 * System information command builder.
 */
export class SystemCommandBuilder {
  private readonly client: HyprCtlClient;

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Get input devices.
   */
  devices(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "devices");
  }

  /**
   * Get layer information.
   */
  layers(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "layers");
  }

  /**
   * Get splash screen info.
   */
  splash(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "splash");
  }

  /**
   * Get cursor position.
   */
  cursorPosition(): QueryCommandBuilder<{ x: number; y: number }> {
    return new QueryCommandBuilder<{ x: number; y: number }>(this.client, "cursorpos");
  }

  /**
   * Get animations info.
   */
  animations(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "animations");
  }

  /**
   * Get Hyprland instances.
   */
  instances(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "instances");
  }

  /**
   * Get available layouts.
   */
  layouts(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "layouts");
  }

  /**
   * Get configuration errors.
   */
  configErrors(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "configerrors");
  }

  /**
   * Get rolling log.
   */
  rollingLog(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "rollinglog");
  }

  /**
   * Get global shortcuts.
   */
  globalShortcuts(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "globalshortcuts");
  }

  /**
   * Get keybinds.
   */
  binds(): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "binds");
  }

  /**
   * Get configuration option value.
   */
  getOption(option: string): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, "getoption", [option]);
  }
}

/**
 * Application execution command builder.
 */
export class ExecutionCommandBuilder {
  private readonly client: HyprCtlClient;

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Execute a program.
   */
  exec(command: string): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "exec", [command]);
  }

  /**
   * Execute a shell command.
   */
  shell(command: string): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, "exec", [`sh -c "${command}"`]);
  }
}

// ============================================================================
// Main Command Builder
// ============================================================================

/**
 * Main HyprCtl command builder providing access to all command categories.
 */
export class HyprCtlCommandBuilder {
  private readonly client: HyprCtlClient;

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Window management commands.
   */
  get windows(): WindowCommandBuilder {
    return new WindowCommandBuilder(this.client);
  }

  /**
   * Workspace management commands.
   */
  get workspaces(): WorkspaceCommandBuilder {
    return new WorkspaceCommandBuilder(this.client);
  }

  /**
   * Monitor management commands.
   */
  get monitors(): MonitorCommandBuilder {
    return new MonitorCommandBuilder(this.client);
  }

  /**
   * System information commands.
   */
  get system(): SystemCommandBuilder {
    return new SystemCommandBuilder(this.client);
  }

  /**
   * Application execution commands.
   */
  get exec(): ExecutionCommandBuilder {
    return new ExecutionCommandBuilder(this.client);
  }

  /**
   * Execute raw command.
   */
  raw(command: HyprCtlCommand, args?: readonly string[]): QueryCommandBuilder<unknown> {
    return new QueryCommandBuilder(this.client, command, args);
  }

  /**
   * Execute raw dispatch command.
   */
  dispatch(
    dispatchCommand: HyprCtlDispatchCommand,
    args?: readonly string[]
  ): DispatchCommandBuilder {
    return new DispatchCommandBuilder(this.client, dispatchCommand, args);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a window selector by address.
 */
export function byAddress(address: string): WindowSelector {
  return { type: "address", value: address };
}

/**
 * Create a window selector by process ID.
 */
export function byPid(pid: number): WindowSelector {
  return { type: "pid", value: pid };
}

/**
 * Create a window selector by class name.
 */
export function byClass(className: string): WindowSelector {
  return { type: "class", value: className };
}

/**
 * Create a window selector by title.
 */
export function byTitle(title: string): WindowSelector {
  return { type: "title", value: title };
}

/**
 * Create a workspace selector by ID.
 */
export function workspaceById(id: number): WorkspaceSelector {
  return { type: "id", value: id };
}

/**
 * Create a workspace selector by name.
 */
export function workspaceByName(name: string): WorkspaceSelector {
  return { type: "name", value: name };
}

/**
 * Create a monitor selector by ID.
 */
export function monitorById(id: number): MonitorSelector {
  return { type: "id", value: id };
}

/**
 * Create a monitor selector by name.
 */
export function monitorByName(name: string): MonitorSelector {
  return { type: "name", value: name };
}
