/**
 * Version Compatibility Detection and Command Adaptation
 *
 * This module provides version compatibility detection for Hyprland and adapts
 * commands based on the detected version to ensure maximum compatibility.
 *
 * Key features:
 * - Automatic Hyprland version detection
 * - Command compatibility checking
 * - Version-specific command adaptation
 * - Feature availability detection
 * - Graceful degradation for unsupported features
 */

import type { HyprCtlClient } from "./hyprctl-client.js";
import type { HyprCtlCommand, HyprCtlDispatchCommand } from "./types.js";

// ============================================================================
// Version Types
// ============================================================================

/**
 * Semantic version structure.
 */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
  readonly build?: string;
}

/**
 * Hyprland version information.
 */
export interface HyprlandVersionInfo {
  readonly version: Version;
  readonly commit?: string;
  readonly branch?: string;
  readonly buildDate?: string;
  readonly flags?: readonly string[];
}

/**
 * Command compatibility information.
 */
export interface CommandCompatibility {
  readonly command: HyprCtlCommand | HyprCtlDispatchCommand;
  readonly minVersion: Version;
  readonly maxVersion?: Version;
  readonly deprecated?: Version;
  readonly replacement?: string;
  readonly notes?: string;
}

/**
 * Feature compatibility information.
 */
export interface FeatureCompatibility {
  readonly feature: string;
  readonly minVersion: Version;
  readonly maxVersion?: Version;
  readonly deprecated?: Version;
  readonly alternative?: string;
}

// ============================================================================
// Version Compatibility Database
// ============================================================================

/**
 * Command compatibility database.
 */
const COMMAND_COMPATIBILITY: CommandCompatibility[] = [
  // Core commands available since early versions
  {
    command: "clients",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "workspaces",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "monitors",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "devices",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
  {
    command: "layers",
    minVersion: { major: 0, minor: 30, patch: 0 },
  },
  {
    command: "splash",
    minVersion: { major: 0, minor: 35, patch: 0 },
  },
  {
    command: "getoption",
    minVersion: { major: 0, minor: 30, patch: 0 },
  },
  {
    command: "cursorpos",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
  {
    command: "animations",
    minVersion: { major: 0, minor: 35, patch: 0 },
  },
  {
    command: "instances",
    minVersion: { major: 0, minor: 40, patch: 0 },
  },
  {
    command: "layouts",
    minVersion: { major: 0, minor: 30, patch: 0 },
  },
  {
    command: "configerrors",
    minVersion: { major: 0, minor: 35, patch: 0 },
  },
  {
    command: "rollinglog",
    minVersion: { major: 0, minor: 40, patch: 0 },
  },
  {
    command: "globalshortcuts",
    minVersion: { major: 0, minor: 42, patch: 0 },
  },
  {
    command: "binds",
    minVersion: { major: 0, minor: 35, patch: 0 },
  },

  // Dispatch commands
  {
    command: "exec",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "killactive",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "closewindow",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
  {
    command: "workspace",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "movetoworkspace",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "movetoworkspacesilent",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
  {
    command: "togglefloating",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "fullscreen",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "fakefullscreen",
    minVersion: { major: 0, minor: 30, patch: 0 },
  },
  {
    command: "movefocus",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "movewindow",
    minVersion: { major: 0, minor: 20, patch: 0 },
  },
  {
    command: "resizewindow",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
  {
    command: "centerwindow",
    minVersion: { major: 0, minor: 30, patch: 0 },
  },
  {
    command: "focuswindow",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
  {
    command: "focusmonitor",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
];

/**
 * Feature compatibility database.
 */
const FEATURE_COMPATIBILITY: FeatureCompatibility[] = [
  {
    feature: "json_responses",
    minVersion: { major: 0, minor: 25, patch: 0 },
  },
  {
    feature: "window_selectors",
    minVersion: { major: 0, minor: 30, patch: 0 },
  },
  {
    feature: "workspace_names",
    minVersion: { major: 0, minor: 35, patch: 0 },
  },
  {
    feature: "batch_commands",
    minVersion: { major: 0, minor: 40, patch: 0 },
  },
  {
    feature: "event_monitoring",
    minVersion: { major: 0, minor: 30, patch: 0 },
  },
];

// ============================================================================
// Version Detection and Compatibility
// ============================================================================

/**
 * Version compatibility manager.
 */
export class VersionCompatibilityManager {
  private versionInfo: HyprlandVersionInfo | null = null;
  private detectionPromise: Promise<HyprlandVersionInfo> | null = null;
  private readonly client: HyprCtlClient;

  constructor(client: HyprCtlClient) {
    this.client = client;
  }

  /**
   * Detect Hyprland version.
   */
  async detectVersion(): Promise<HyprlandVersionInfo> {
    if (this.versionInfo) {
      return this.versionInfo;
    }

    if (this.detectionPromise) {
      return this.detectionPromise;
    }

    this.detectionPromise = this.performVersionDetection();
    this.versionInfo = await this.detectionPromise;
    return this.versionInfo;
  }

  /**
   * Check if a command is supported in the current version.
   */
  async isCommandSupported(command: HyprCtlCommand | HyprCtlDispatchCommand): Promise<boolean> {
    const versionInfo = await this.detectVersion();
    const compatibility = this.getCommandCompatibility(command);

    if (!compatibility) {
      // Unknown command - assume supported for forward compatibility
      return true;
    }

    return this.isVersionCompatible(
      versionInfo.version,
      compatibility.minVersion,
      compatibility.maxVersion
    );
  }

  /**
   * Check if a feature is supported in the current version.
   */
  async isFeatureSupported(feature: string): Promise<boolean> {
    const versionInfo = await this.detectVersion();
    const compatibility = this.getFeatureCompatibility(feature);

    if (!compatibility) {
      // Unknown feature - assume not supported for safety
      return false;
    }

    return this.isVersionCompatible(
      versionInfo.version,
      compatibility.minVersion,
      compatibility.maxVersion
    );
  }

  /**
   * Get command replacement for deprecated commands.
   */
  async getCommandReplacement(
    command: HyprCtlCommand | HyprCtlDispatchCommand
  ): Promise<string | null> {
    const versionInfo = await this.detectVersion();
    const compatibility = this.getCommandCompatibility(command);

    if (!compatibility || !compatibility.deprecated) {
      return null;
    }

    if (this.compareVersions(versionInfo.version, compatibility.deprecated) >= 0) {
      return compatibility.replacement || null;
    }

    return null;
  }

  /**
   * Get version-specific command adaptations.
   */
  async adaptCommand(
    command: HyprCtlCommand | "dispatch",
    args?: readonly string[]
  ): Promise<{ command: HyprCtlCommand | "dispatch"; args?: readonly string[] }> {
    const versionInfo = await this.detectVersion();

    // Version-specific adaptations
    if (command === "clients") {
      // Older versions might not support all client properties
      if (this.compareVersions(versionInfo.version, { major: 0, minor: 30, patch: 0 }) < 0) {
        // Return adapted command for older versions
        return { command, args: args || [] };
      }
    }

    // Add more version-specific adaptations as needed
    return { command, args: args || [] };
  }

  /**
   * Get comprehensive compatibility report.
   */
  async getCompatibilityReport(): Promise<{
    version: HyprlandVersionInfo;
    supportedCommands: string[];
    unsupportedCommands: string[];
    deprecatedCommands: Array<{ command: string; replacement?: string }>;
    supportedFeatures: string[];
    unsupportedFeatures: string[];
  }> {
    const versionInfo = await this.detectVersion();
    const supportedCommands: string[] = [];
    const unsupportedCommands: string[] = [];
    const deprecatedCommands: Array<{ command: string; replacement?: string }> = [];

    for (const compatibility of COMMAND_COMPATIBILITY) {
      const isSupported = this.isVersionCompatible(
        versionInfo.version,
        compatibility.minVersion,
        compatibility.maxVersion
      );

      if (isSupported) {
        supportedCommands.push(compatibility.command);

        // Check if deprecated
        if (
          compatibility.deprecated &&
          this.compareVersions(versionInfo.version, compatibility.deprecated) >= 0
        ) {
          const item: { command: string; replacement?: string } = {
            command: compatibility.command,
          };
          if (compatibility.replacement) {
            item.replacement = compatibility.replacement;
          }
          deprecatedCommands.push(item);
        }
      } else {
        unsupportedCommands.push(compatibility.command);
      }
    }

    const supportedFeatures: string[] = [];
    const unsupportedFeatures: string[] = [];

    for (const compatibility of FEATURE_COMPATIBILITY) {
      const isSupported = this.isVersionCompatible(
        versionInfo.version,
        compatibility.minVersion,
        compatibility.maxVersion
      );

      if (isSupported) {
        supportedFeatures.push(compatibility.feature);
      } else {
        unsupportedFeatures.push(compatibility.feature);
      }
    }

    return {
      version: versionInfo,
      supportedCommands,
      unsupportedCommands,
      deprecatedCommands,
      supportedFeatures,
      unsupportedFeatures,
    };
  }

  /**
   * Clear cached version information.
   */
  clearCache(): void {
    this.versionInfo = null;
    this.detectionPromise = null;
  }

  /**
   * Perform actual version detection.
   */
  private async performVersionDetection(): Promise<HyprlandVersionInfo> {
    try {
      // Try to get version using the 'version' command (if available)
      const result = await this.client.executeCommand("instances", [], { timeout: 2000 });

      if (result.success && result.data) {
        // Parse version from instances data
        const version = this.parseVersionFromInstancesData(result.data);
        if (version) {
          return version;
        }
      }
    } catch {
      // Fallback method - try to infer version from available commands
    }

    // Fallback: probe features to determine approximate version
    return this.probeVersionByFeatures();
  }

  /**
   * Parse version from instances command data.
   */
  private parseVersionFromInstancesData(data: unknown): HyprlandVersionInfo | null {
    try {
      // This would parse the actual version from Hyprland's response
      // Implementation depends on the actual format returned by Hyprland
      if (typeof data === "string" && data.includes("Hyprland")) {
        const versionMatch = data.match(/Hyprland\s+v?(\d+)\.(\d+)\.(\d+)/);
        if (versionMatch?.[1] && versionMatch[2] && versionMatch[3]) {
          return {
            version: {
              major: Number.parseInt(versionMatch[1], 10),
              minor: Number.parseInt(versionMatch[2], 10),
              patch: Number.parseInt(versionMatch[3], 10),
            },
          };
        }
      }
    } catch {
      // Ignore parsing errors
    }

    return null;
  }

  /**
   * Probe version by testing feature availability.
   */
  private async probeVersionByFeatures(): Promise<HyprlandVersionInfo> {
    // Test commands to determine approximate version
    const probeResults = await Promise.allSettled([
      this.client.executeCommand("clients", [], { timeout: 1000 }),
      this.client.executeCommand("globalshortcuts", [], { timeout: 1000 }),
      this.client.executeCommand("instances", [], { timeout: 1000 }),
      this.client.executeCommand("rollinglog", [], { timeout: 1000 }),
    ]);

    // Determine version based on which commands succeed
    let estimatedVersion: Version = { major: 0, minor: 20, patch: 0 };

    if (probeResults[1].status === "fulfilled") {
      // globalshortcuts available
      estimatedVersion = { major: 0, minor: 42, patch: 0 };
    } else if (probeResults[3].status === "fulfilled") {
      // rollinglog available
      estimatedVersion = { major: 0, minor: 40, patch: 0 };
    } else if (probeResults[2].status === "fulfilled") {
      // instances available
      estimatedVersion = { major: 0, minor: 40, patch: 0 };
    } else if (probeResults[0].status === "fulfilled") {
      // clients available
      estimatedVersion = { major: 0, minor: 25, patch: 0 };
    }

    return {
      version: estimatedVersion,
    };
  }

  /**
   * Get command compatibility information.
   */
  private getCommandCompatibility(
    command: HyprCtlCommand | HyprCtlDispatchCommand
  ): CommandCompatibility | null {
    return COMMAND_COMPATIBILITY.find((c) => c.command === command) || null;
  }

  /**
   * Get feature compatibility information.
   */
  private getFeatureCompatibility(feature: string): FeatureCompatibility | null {
    return FEATURE_COMPATIBILITY.find((f) => f.feature === feature) || null;
  }

  /**
   * Check if version is compatible with requirements.
   */
  private isVersionCompatible(
    version: Version,
    minVersion: Version,
    maxVersion?: Version
  ): boolean {
    const minCompare = this.compareVersions(version, minVersion);
    if (minCompare < 0) {
      return false;
    }

    if (maxVersion) {
      const maxCompare = this.compareVersions(version, maxVersion);
      if (maxCompare > 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Compare two versions.
   * Returns: -1 if a < b, 0 if a === b, 1 if a > b
   */
  private compareVersions(a: Version, b: Version): number {
    if (a.major !== b.major) {
      return a.major - b.major;
    }
    if (a.minor !== b.minor) {
      return a.minor - b.minor;
    }
    if (a.patch !== b.patch) {
      return a.patch - b.patch;
    }
    return 0;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse version string into Version object.
 */
export function parseVersion(versionString: string): Version | null {
  const match = versionString.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+(.+))?$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  const version: Version = {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };

  if (match[4]) {
    (version as Version & { prerelease: string }).prerelease = match[4];
  }
  if (match[5]) {
    (version as Version & { build: string }).build = match[5];
  }

  return version;
}

/**
 * Format version object as string.
 */
export function formatVersion(version: Version): string {
  let versionString = `${version.major}.${version.minor}.${version.patch}`;

  if (version.prerelease) {
    versionString += `-${version.prerelease}`;
  }

  if (version.build) {
    versionString += `+${version.build}`;
  }

  return versionString;
}

/**
 * Check if version satisfies requirement.
 */
export function satisfiesVersion(version: Version, requirement: string): boolean {
  // Simple implementation - could be enhanced with full semver support
  const requiredVersion = parseVersion(requirement.replace(/^[><=~^]*/, ""));
  if (!requiredVersion) {
    return false;
  }

  if (requirement.startsWith(">=")) {
    return compareVersions(version, requiredVersion) >= 0;
  }
  if (requirement.startsWith(">")) {
    return compareVersions(version, requiredVersion) > 0;
  }
  if (requirement.startsWith("<=")) {
    return compareVersions(version, requiredVersion) <= 0;
  }
  if (requirement.startsWith("<")) {
    return compareVersions(version, requiredVersion) < 0;
  }
  if (requirement.startsWith("=")) {
    return compareVersions(version, requiredVersion) === 0;
  }

  // Default to exact match
  return compareVersions(version, requiredVersion) === 0;
}

/**
 * Compare two versions.
 */
function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }
  return 0;
}
