/**
 * Runtime type validation utilities for Hyprland API responses
 * Provides type guards and validators for safe runtime type checking
 */

import type {
  HyprlandEvent,
  HyprlandMonitor,
  HyprlandWindow,
  HyprlandWorkspace,
  HyprlandWorkspaceInfo,
  TypePredicate,
  ValidationResult,
} from "./types.js";

// ============================================================================
// Utility Functions
// ============================================================================

/** Check if value is a non-null object */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Check if value is a number */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Check if value is a string */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Check if value is a boolean */
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Check if value is an array of numbers with specific length */
function isNumberArray(value: unknown, length?: number): value is readonly number[] {
  if (!Array.isArray(value)) {
    return false;
  }
  if (length !== undefined && value.length !== length) {
    return false;
  }
  return value.every(isNumber);
}

/** Create a successful validation result */
function createSuccessResult<T>(data: T): ValidationResult<T> {
  return {
    success: true,
    data,
    errors: undefined,
  };
}

/** Create a failed validation result */
function createFailureResult<T>(errors: readonly string[]): ValidationResult<T> {
  return {
    success: false,
    data: undefined,
    errors,
  } as ValidationResult<T>;
}

// ============================================================================
// Type Guards
// ============================================================================

/** Type guard for HyprlandWorkspaceInfo */
export const isHyprlandWorkspaceInfo: TypePredicate<HyprlandWorkspaceInfo> = (
  value
): value is HyprlandWorkspaceInfo => {
  if (!isObject(value)) {
    return false;
  }

  return isNumber(value["id"]) && isString(value["name"]);
};

/** Type guard for HyprlandWindow */
export const isHyprlandWindow: TypePredicate<HyprlandWindow> = (value): value is HyprlandWindow => {
  if (!isObject(value)) {
    return false;
  }

  return (
    isString(value["address"]) &&
    isBoolean(value["mapped"]) &&
    isBoolean(value["hidden"]) &&
    isNumberArray(value["at"], 2) &&
    isNumberArray(value["size"], 2) &&
    isObject(value["workspace"]) &&
    isHyprlandWorkspaceInfo(value["workspace"]) &&
    isBoolean(value["floating"]) &&
    isNumber(value["monitor"]) &&
    isString(value["class"]) &&
    isString(value["title"]) &&
    isNumber(value["pid"]) &&
    isBoolean(value["xwayland"]) &&
    isBoolean(value["pinned"]) &&
    isBoolean(value["fullscreen"]) &&
    isNumber(value["fullscreenMode"]) &&
    isNumber(value["focusHistoryID"])
  );
};

/** Type guard for HyprlandWorkspace */
export const isHyprlandWorkspace: TypePredicate<HyprlandWorkspace> = (
  value
): value is HyprlandWorkspace => {
  if (!isObject(value)) {
    return false;
  }

  return (
    isNumber(value["id"]) &&
    isString(value["name"]) &&
    isString(value["monitor"]) &&
    isNumber(value["monitorID"]) &&
    isNumber(value["windows"]) &&
    isBoolean(value["hasfullscreen"]) &&
    isString(value["lastwindow"]) &&
    isString(value["lastwindowtitle"])
  );
};

/** Type guard for HyprlandMonitor */
export const isHyprlandMonitor: TypePredicate<HyprlandMonitor> = (
  value
): value is HyprlandMonitor => {
  if (!isObject(value)) {
    return false;
  }

  return (
    isNumber(value["id"]) &&
    isString(value["name"]) &&
    isString(value["description"]) &&
    isString(value["make"]) &&
    isString(value["model"]) &&
    isString(value["serial"]) &&
    isNumber(value["width"]) &&
    isNumber(value["height"]) &&
    isNumber(value["refreshRate"]) &&
    isNumber(value["x"]) &&
    isNumber(value["y"]) &&
    isObject(value["activeWorkspace"]) &&
    isHyprlandWorkspaceInfo(value["activeWorkspace"]) &&
    isObject(value["specialWorkspace"]) &&
    isHyprlandWorkspaceInfo(value["specialWorkspace"]) &&
    isNumberArray(value["reserved"], 4) &&
    isNumber(value["scale"]) &&
    isNumber(value["transform"]) &&
    isBoolean(value["focused"]) &&
    isBoolean(value["dpmsStatus"]) &&
    isBoolean(value["vrr"]) &&
    Array.isArray(value["availableModes"]) &&
    (value["availableModes"] as unknown[]).every(isString)
  );
};

/** Type guard for HyprlandEvent */
export const isHyprlandEvent: TypePredicate<HyprlandEvent> = (value): value is HyprlandEvent => {
  if (!isObject(value)) {
    return false;
  }

  return isString(value["event"]) && value["data"] !== undefined;
};

// ============================================================================
// Validators
// ============================================================================

/** Validate HyprlandWindow with detailed error reporting */
export const validateHyprlandWindow = (value: unknown): ValidationResult<HyprlandWindow> => {
  const errors: string[] = [];

  if (!isObject(value)) {
    return createFailureResult(["Value must be an object"]);
  }

  if (!isString(value["address"])) {
    errors.push("address must be a string");
  }
  if (!isBoolean(value["mapped"])) {
    errors.push("mapped must be a boolean");
  }
  if (!isBoolean(value["hidden"])) {
    errors.push("hidden must be a boolean");
  }
  if (!isNumberArray(value["at"], 2)) {
    errors.push("at must be an array of 2 numbers");
  }
  if (!isNumberArray(value["size"], 2)) {
    errors.push("size must be an array of 2 numbers");
  }

  if (!isObject(value["workspace"])) {
    errors.push("workspace must be an object");
  } else if (!isHyprlandWorkspaceInfo(value["workspace"])) {
    errors.push("workspace must be a valid HyprlandWorkspaceInfo");
  }

  if (!isBoolean(value["floating"])) {
    errors.push("floating must be a boolean");
  }
  if (!isNumber(value["monitor"])) {
    errors.push("monitor must be a number");
  }
  if (!isString(value["class"])) {
    errors.push("class must be a string");
  }
  if (!isString(value["title"])) {
    errors.push("title must be a string");
  }
  if (!isNumber(value["pid"])) {
    errors.push("pid must be a number");
  }
  if (!isBoolean(value["xwayland"])) {
    errors.push("xwayland must be a boolean");
  }
  if (!isBoolean(value["pinned"])) {
    errors.push("pinned must be a boolean");
  }
  if (!isBoolean(value["fullscreen"])) {
    errors.push("fullscreen must be a boolean");
  }
  if (!isNumber(value["fullscreenMode"])) {
    errors.push("fullscreenMode must be a number");
  }
  if (!isNumber(value["focusHistoryID"])) {
    errors.push("focusHistoryID must be a number");
  }

  if (errors.length > 0) {
    return createFailureResult(errors);
  }

  return createSuccessResult(value as unknown as HyprlandWindow);
};

/** Validate HyprlandWorkspace with detailed error reporting */
export const validateHyprlandWorkspace = (value: unknown): ValidationResult<HyprlandWorkspace> => {
  const errors: string[] = [];

  if (!isObject(value)) {
    return createFailureResult(["Value must be an object"]);
  }

  if (!isNumber(value["id"])) {
    errors.push("id must be a number");
  }
  if (!isString(value["name"])) {
    errors.push("name must be a string");
  }
  if (!isString(value["monitor"])) {
    errors.push("monitor must be a string");
  }
  if (!isNumber(value["monitorID"])) {
    errors.push("monitorID must be a number");
  }
  if (!isNumber(value["windows"])) {
    errors.push("windows must be a number");
  }
  if (!isBoolean(value["hasfullscreen"])) {
    errors.push("hasfullscreen must be a boolean");
  }
  if (!isString(value["lastwindow"])) {
    errors.push("lastwindow must be a string");
  }
  if (!isString(value["lastwindowtitle"])) {
    errors.push("lastwindowtitle must be a string");
  }

  if (errors.length > 0) {
    return createFailureResult(errors);
  }

  return createSuccessResult(value as unknown as HyprlandWorkspace);
};

/** Validate HyprlandMonitor with detailed error reporting */
export const validateHyprlandMonitor = (value: unknown): ValidationResult<HyprlandMonitor> => {
  const errors: string[] = [];

  if (!isObject(value)) {
    return createFailureResult(["Value must be an object"]);
  }

  if (!isNumber(value["id"])) {
    errors.push("id must be a number");
  }
  if (!isString(value["name"])) {
    errors.push("name must be a string");
  }
  if (!isString(value["description"])) {
    errors.push("description must be a string");
  }
  if (!isString(value["make"])) {
    errors.push("make must be a string");
  }
  if (!isString(value["model"])) {
    errors.push("model must be a string");
  }
  if (!isString(value["serial"])) {
    errors.push("serial must be a string");
  }
  if (!isNumber(value["width"])) {
    errors.push("width must be a number");
  }
  if (!isNumber(value["height"])) {
    errors.push("height must be a number");
  }
  if (!isNumber(value["refreshRate"])) {
    errors.push("refreshRate must be a number");
  }
  if (!isNumber(value["x"])) {
    errors.push("x must be a number");
  }
  if (!isNumber(value["y"])) {
    errors.push("y must be a number");
  }

  if (!isObject(value["activeWorkspace"])) {
    errors.push("activeWorkspace must be an object");
  } else if (!isHyprlandWorkspaceInfo(value["activeWorkspace"])) {
    errors.push("activeWorkspace must be a valid HyprlandWorkspaceInfo");
  }

  if (!isObject(value["specialWorkspace"])) {
    errors.push("specialWorkspace must be an object");
  } else if (!isHyprlandWorkspaceInfo(value["specialWorkspace"])) {
    errors.push("specialWorkspace must be a valid HyprlandWorkspaceInfo");
  }

  if (!isNumberArray(value["reserved"], 4)) {
    errors.push("reserved must be an array of 4 numbers");
  }
  if (!isNumber(value["scale"])) {
    errors.push("scale must be a number");
  }
  if (!isNumber(value["transform"])) {
    errors.push("transform must be a number");
  }
  if (!isBoolean(value["focused"])) {
    errors.push("focused must be a boolean");
  }
  if (!isBoolean(value["dpmsStatus"])) {
    errors.push("dpmsStatus must be a boolean");
  }
  if (!isBoolean(value["vrr"])) {
    errors.push("vrr must be a boolean");
  }

  if (!Array.isArray(value["availableModes"])) {
    errors.push("availableModes must be an array");
  } else if (!(value["availableModes"] as unknown[]).every(isString)) {
    errors.push("availableModes must be an array of strings");
  }

  if (errors.length > 0) {
    return createFailureResult(errors);
  }

  return createSuccessResult(value as unknown as HyprlandMonitor);
};

/** Validate array of HyprlandWindow objects */
export const validateHyprlandWindowArray = (
  value: unknown
): ValidationResult<readonly HyprlandWindow[]> => {
  if (!Array.isArray(value)) {
    return createFailureResult(["Value must be an array"]);
  }

  const errors: string[] = [];
  const validatedWindows: HyprlandWindow[] = [];

  for (let i = 0; i < value.length; i++) {
    const result = validateHyprlandWindow(value[i]);
    if (!result.success) {
      errors.push(`Window at index ${i}: ${result.errors?.join(", ")}`);
    } else if (result.data) {
      validatedWindows.push(result.data);
    }
  }

  if (errors.length > 0) {
    return createFailureResult(errors);
  }

  return createSuccessResult(validatedWindows as readonly HyprlandWindow[]);
};

/** Validate array of HyprlandWorkspace objects */
export const validateHyprlandWorkspaceArray = (
  value: unknown
): ValidationResult<readonly HyprlandWorkspace[]> => {
  if (!Array.isArray(value)) {
    return createFailureResult(["Value must be an array"]);
  }

  const errors: string[] = [];
  const validatedWorkspaces: HyprlandWorkspace[] = [];

  for (let i = 0; i < value.length; i++) {
    const result = validateHyprlandWorkspace(value[i]);
    if (!result.success) {
      errors.push(`Workspace at index ${i}: ${result.errors?.join(", ")}`);
    } else if (result.data) {
      validatedWorkspaces.push(result.data);
    }
  }

  if (errors.length > 0) {
    return createFailureResult(errors);
  }

  return createSuccessResult(validatedWorkspaces as readonly HyprlandWorkspace[]);
};

/** Validate array of HyprlandMonitor objects */
export const validateHyprlandMonitorArray = (
  value: unknown
): ValidationResult<readonly HyprlandMonitor[]> => {
  if (!Array.isArray(value)) {
    return createFailureResult(["Value must be an array"]);
  }

  const errors: string[] = [];
  const validatedMonitors: HyprlandMonitor[] = [];

  for (let i = 0; i < value.length; i++) {
    const result = validateHyprlandMonitor(value[i]);
    if (!result.success) {
      errors.push(`Monitor at index ${i}: ${result.errors?.join(", ")}`);
    } else if (result.data) {
      validatedMonitors.push(result.data);
    }
  }

  if (errors.length > 0) {
    return createFailureResult(errors);
  }

  return createSuccessResult(validatedMonitors as readonly HyprlandMonitor[]);
};
