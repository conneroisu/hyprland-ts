---
id: task-002
title: Define core TypeScript type definitions
status: In Progress
assignee: []
created_date: '2025-07-26'
updated_date: '2025-07-26'
labels:
  - types
  - core
dependencies:
  - task-001
priority: high
---

## Description

Create comprehensive TypeScript type definitions for Hyprland data structures, events, and API responses to ensure type safety throughout the library

## Acceptance Criteria

- [ ] Window type definition with all properties from Hyprland API
- [ ] Workspace type definition with complete structure and metadata
- [ ] Monitor type definition including all display properties and capabilities
- [ ] Event type definitions for all Hyprland event types with proper payloads
- [ ] HyprCtl command and response type definitions with parameter validation
- [ ] Configuration option type definitions matching Hyprland config schema
- [ ] IPC protocol message types for socket communication
- [ ] Runtime type validation utilities for API responses
- [ ] Version compatibility annotations for type evolution
- [ ] All types exported from a central types module with proper documentation
- [ ] Type definitions tested against actual Hyprland API responses
- [ ] Dependency on task-001 infrastructure setup completion

## Implementation Plan

1. Analyze existing types.ts file and current structure\n2. Define comprehensive Window/Client type with all JSON properties\n3. Define complete Workspace type with metadata and relationships\n4. Define Monitor type with display properties and capabilities\n5. Create Event type definitions for all Hyprland event types\n6. Define HyprCtl command and response types\n7. Add Configuration option types\n8. Create IPC protocol message types\n9. Implement runtime type validation utilities\n10. Add version compatibility annotations\n11. Reorganize types module with proper exports and documentation\n12. Test types against actual Hyprland API responses
