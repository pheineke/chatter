# Structural Audit — Frontend Architecture & UX Patterns

This document tracks architectural inconsistencies, code duplication, and UI/UX pattern deviations identified during development.

## 1. High-Level Layout Patterns

### L1. Duplicate Settings Shell Implementations
- **Problem**: `ChannelSettingsPage`, `ServerSettingsPage`, and `SettingsPage` each manually recompose `LayoutShell`, `NavPanel`, and `ContentPanel`. They duplicate logic for:
  - Sidebar rendering (iterating tabs).
  - Mobile responsiveness (though inconsistent).
  - Close button and Escape key handling.
  - Header rendering in the sidebar.
- **Impact**: Inconsistent padding, mobile behavior, and maintenance overhead.
- **Fix**: Extract a `SettingsLayout` component that accepts `tabs`, `activeTab`, `onTabChange`, `title`, and `onClose`.

### L2. Inconsistent Modal vs. Page Usage
- **Problem**: Complex settings are split between full-page routes (Channels, Server, User Settings) and modals (`InviteModal`, `ProfileFullModal`).
- **Impact**: Inconsistent user experience.
- **Recommendation**: Standardize on full-page layouts for complex configuration and modals for single-action flows (e.g., Invite creation).

## 2. Default Values & Constants

### C1. Hardcoded Magic Numbers
- **Problem**: Bitrate limits (8kbps - 96kbps), slowmode steps, and user limits are hardcoded in `ChannelSettingsPage.tsx`.
- **Impact**: If backend validations change, frontend will be out of sync.
- **Fix**: Move these to `src/constants/channels.ts` or fetch from a configuration endpoint.

## 3. Business Logic Location

### B1. Permissions Logic in UI Components
- **Problem**: Bitwise permission logic (`getPermState`, `cyclePermState`, `applyPermState`) resides inside `ChannelSettingsPage.tsx`.
- **Impact**: Cannot easily be reused for Role settings or Category permissions.
- **Fix**: Move to `src/utils/permissions.ts`.

### B2. Sidebar Complexity
- **Problem**: `ChannelSidebar.tsx` contains heavy logic for drag-and-drop, context menus, and category management (600+ lines).
- **Fix**: Extract `ChannelList`, `CategoryRow`, `CreateChannelModal` into separate components.
