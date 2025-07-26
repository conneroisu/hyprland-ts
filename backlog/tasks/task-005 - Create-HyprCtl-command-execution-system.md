---
id: task-005
title: Create HyprCtl command execution system
status: To Do
assignee: []
created_date: '2025-07-26'
labels:
  - hyprctl
  - ipc
dependencies:
  - task-004
priority: high
---

## Description

Implement a system for executing HyprCtl commands through the primary IPC socket with proper request formatting and response parsing

## Acceptance Criteria

- [ ] Command execution function accepts typed command parameters
- [ ] Requests properly formatted for Hyprland IPC protocol
- [ ] Response parsing handles JSON and text responses correctly
- [ ] Error handling for invalid commands and socket errors
- [ ] Timeout handling for unresponsive commands
- [ ] Type-safe command builder for common operations
- [ ] Integration tests verify commands work with mock responses
