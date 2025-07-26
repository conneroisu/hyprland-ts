---
id: task-003
title: Implement socket path resolution system
status: To Do
assignee: []
created_date: '2025-07-26'
updated_date: '2025-07-26'
labels:
  - core
  - ipc
dependencies:
  - task-002
priority: high
---

## Description

Create a robust system for discovering and connecting to Hyprland IPC sockets using the Hyprland Instance Signature and runtime directory

## Acceptance Criteria

- [ ] Function correctly resolves socket paths using HYPRLAND_INSTANCE_SIGNATURE environment variable
- [ ] System falls back to XDG_RUNTIME_DIR when HYPRLAND_INSTANCE_SIGNATURE is not set
- [ ] Socket path validation ensures sockets exist and have correct permissions
- [ ] Support for both primary socket (.socket.sock) and event socket (.socket2.sock) discovery
- [ ] Multi-instance support by detecting and listing all available Hyprland instances
- [ ] Socket permission verification (readable/writable access)
- [ ] Discovery logic handles edge cases like missing runtime directories
- [ ] Error handling provides actionable error messages for socket resolution failures
- [ ] Function returns typed socket path information including instance metadata
- [ ] Performance optimization with socket path caching for repeated lookups
- [ ] Unit tests verify socket resolution under various environment conditions
- [ ] Integration tests verify compatibility with actual Hyprland socket naming patterns
