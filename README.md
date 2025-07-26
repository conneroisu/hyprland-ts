# hyprland-ts

A robust TypeScript library for interfacing with the Hyprland window manager.

## Overview

hyprland-ts provides a type-safe, comprehensive interface for communicating with Hyprland's IPC system. Built with safety, performance, and developer experience in mind, it offers runtime type validation and comprehensive error handling for reliable integration with Hyprland.

## Features

- **Type-safe IPC communication** - Complete TypeScript definitions for all Hyprland data structures
- **Runtime validation** - Comprehensive type guards and validators with detailed error reporting
- **Event handling** - Subscribe to window, workspace, and monitor events
- **Window management** - Control window positioning, sizing, and properties
- **Workspace operations** - Manage workspaces and monitor layouts
- **Monitor configuration** - Query and control monitor settings
- **Comprehensive testing** - Full test suite with 27 validation tests ensuring reliability

## Installation

```bash
npm install hyprland-ts
```

## Usage

### Basic Validation

```typescript
import { validateHyprlandWindow, isHyprlandWindow } from 'hyprland-ts';

// Validate window data with detailed error reporting
const result = validateHyprlandWindow(unknownData);
if (result.success) {
  console.log('Valid window:', result.data);
} else {
  console.error('Validation errors:', result.errors);
}

// Type guard for runtime checking
if (isHyprlandWindow(data)) {
  // TypeScript knows data is HyprlandWindow
  console.log(data.title, data.class);
}
```

### Array Validation

```typescript
import { validateHyprlandWindowArray } from 'hyprland-ts';

const windowsResult = validateHyprlandWindowArray(responseData);
if (windowsResult.success) {
  windowsResult.data.forEach(window => {
    console.log(`Window: ${window.title} (${window.class})`);
  });
}
```

### Type Definitions

```typescript
import type { 
  HyprlandWindow, 
  HyprlandWorkspace, 
  HyprlandMonitor,
  ValidationResult 
} from 'hyprland-ts';

// Use comprehensive type definitions
function processWindow(window: HyprlandWindow) {
  const { address, title, workspace, floating } = window;
  // Full type safety and IntelliSense support
}
```

## API Reference

### Validation Functions

- `validateHyprlandWindow(data)` - Validate window objects with detailed error reporting
- `validateHyprlandWorkspace(data)` - Validate workspace objects
- `validateHyprlandMonitor(data)` - Validate monitor objects
- `validateHyprlandWindowArray(data)` - Validate arrays of windows
- `validateHyprlandWorkspaceArray(data)` - Validate arrays of workspaces
- `validateHyprlandMonitorArray(data)` - Validate arrays of monitors

### Type Guards

- `isHyprlandWindow(data)` - Type guard for window objects
- `isHyprlandWorkspace(data)` - Type guard for workspace objects
- `isHyprlandMonitor(data)` - Type guard for monitor objects
- `isHyprlandWorkspaceInfo(data)` - Type guard for workspace info objects

### Core Types

- `HyprlandWindow` - Complete window object definition
- `HyprlandWorkspace` - Workspace object with all properties
- `HyprlandMonitor` - Monitor configuration and status
- `HyprlandWorkspaceInfo` - Simplified workspace reference
- `ValidationResult<T>` - Result object with success status and error details

## Requirements

- Node.js 18+
- TypeScript 5.0+ (for development)
- Hyprland window manager (for runtime usage)

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests (27 validation tests)
npm run test

# Run tests with coverage
npm run test:coverage

# Lint and format code
npm run lint:fix
npm run format

# Type checking
npm run type-check

# Clean build artifacts
npm run clean
```

### Project Structure

```
src/
├── types.ts           # Core type definitions
├── validation.ts      # Runtime validation and type guards
├── test-utils.ts      # Test utilities and mock data generators
├── basic.spec.ts      # Basic functionality tests
├── utils.spec.ts      # Utility function tests
└── validation.spec.ts # Comprehensive validation tests (22 tests)
```

## Contributing

This project follows strict coding standards inspired by TigerBeetle's engineering practices:

- **Safety**: Comprehensive type checking and runtime validation
- **Performance**: Efficient validation algorithms and minimal overhead
- **Developer Experience**: Clear error messages and excellent TypeScript support

All code must pass linting, type checking, and comprehensive tests before submission.

## License

MIT
