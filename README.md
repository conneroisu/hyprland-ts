# Hyprland TypeScript

A TypeScript library for interacting with Hyprland's IPC interface.

## Overview

This library provides a type-safe interface for communicating with Hyprland's Unix socket IPC, enabling control and monitoring of the Hyprland compositor from TypeScript/JavaScript applications.

## Features

- Type-safe IPC communication with Hyprland
- Event subscription and handling
- Window and workspace management
- Configuration querying and updates
- Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install hyprland-ts
```

## Usage

```typescript
import { HyprlandClient } from 'hyprland-ts';

const client = new HyprlandClient();

// Get active window
const activeWindow = await client.getActiveWindow();
console.log(activeWindow);

// Subscribe to events
client.on('workspace', (event) => {
  console.log('Workspace changed:', event);
});
```

## Requirements

- Node.js 18+ 
- Hyprland compositor running
- Access to Hyprland's IPC socket

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run linting
npm run lint
```

## License

MIT
