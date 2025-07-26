---
id: task-004
title: Build low-level UNIX socket communication layer
status: To Do
assignee: []
created_date: '2025-07-26'
labels:
  - core
  - ipc
  - socket
dependencies:
  - task-003
priority: high
---

## Description

Implement the foundational UNIX socket communication layer for sending commands and receiving responses from Hyprland IPC sockets

## Acceptance Criteria

- [ ] Socket connection establishment and cleanup properly managed
- [ ] Reliable message sending with proper error handling
- [ ] Message receiving with timeout and error handling
- [ ] Connection state management (connected/disconnected/error)
- [ ] Proper resource cleanup on connection close or error
- [ ] Support for both request-response and streaming patterns
- [ ] Unit tests cover connection lifecycle and error scenarios
