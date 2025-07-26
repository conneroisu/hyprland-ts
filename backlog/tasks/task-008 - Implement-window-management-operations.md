---
id: task-008
title: Implement window management operations
status: To Do
assignee: []
created_date: '2025-07-26'
updated_date: '2025-07-26'
labels:
  - windows
  - api
dependencies:
  - task-007
priority: medium
---

## Description

Add comprehensive window management functionality including querying, focusing, moving, and manipulating windows through the HyprlandClient

## Acceptance Criteria

- [ ] Get active window with complete type-safe information
- [ ] List all windows with filtering capabilities by workspace and properties
- [ ] Focus window by ID or criteria with validation
- [ ] Move and resize windows programmatically with bounds checking
- [ ] Change window properties including floating state effectively
- [ ] Change window properties including fullscreen mode effectively
- [ ] Change window properties including workspace assignment effectively
- [ ] Close windows safely with proper error handling and confirmation
- [ ] Window operation results properly typed and validated
- [ ] Window state changes trigger appropriate events and callbacks
- [ ] Window management operations handle edge cases gracefully
- [ ] All window operations support both synchronous and asynchronous execution
