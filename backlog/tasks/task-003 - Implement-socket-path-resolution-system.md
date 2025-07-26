---
id: task-003
title: Implement socket path resolution system
status: To Do
assignee: []
created_date: '2025-07-26'
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

- [ ] Function correctly resolves socket paths using HYPRLAND_INSTANCE_SIGNATURE
- [ ] System handles missing environment variables gracefully
- [ ] Socket path validation ensures sockets exist and are accessible
- [ ] Support for both primary socket (.socket.sock) and event socket (.socket2.sock)
- [ ] Error handling for invalid or inaccessible socket paths
- [ ] Unit tests verify socket resolution under various conditions
