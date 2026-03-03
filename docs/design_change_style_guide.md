# Design Change Style Guide

**Theme reference:** softpop2 — Material Professional (M3 tonal, dark mode)

## 1. Channel Header & Search
- Move the search icon from next to the server name to the far right of the channel header.
- Clicking the search icon opens a modal overlay for searching.

## 2. Members Sidebar
- Members sidebar should extend from the very top to the bottom of the app window.
- Channel header should only span the channel area, not the full width.

## ~~3. Color Palette~~ ✅ Implemented
- ~~Update the color scheme, especially the primary "blurple" color (currently `#5865f2`).~~
- **Done:** `#5865f2` replaced with M3 Indigo `#3F51B5` across all tokens. Full M3 dark surface
  hierarchy applied: `bg #111116` → `surface #1B1B1F` → `surface-container #23232A` → `input #2D2E36`.
  Text tokens: `text #E3E2E6`, `muted #C7C6D0`, `outline/divider #44464F`.
  All hardcoded `#5865F2` banner fallbacks updated. `colorOverrides.ts` default accent updated.

## ~~4. Server/DM Button Hover~~ ✅ Implemented
- ~~Remove the squircle (rounded square) effect on hover for server and DM buttons.~~
- **Done:** All three nav-rail buttons in `ServerSidebar.tsx` now use `rounded-m3-md` (12px)
  as a static shape. Hover is a flat background tint (`hover:bg-discord-hover`) — no shape morph.

## 5. Channel Icons
- Replace the hashtag icon for text channels with a new, distinct icon (to be provided).

## 6. Settings Layout
- Redesign the settings layout for better usability and visual clarity.
- Consider a sidebar or tabbed interface for settings sections.

## 7. User Control Center
- Redesign the user control center at the bottom left.
- Awaiting HTML example for implementation details.

## ~~8. Paper Elements~~ ✅ Implemented
- ~~Explore adding more "Paper"-style UI elements inspired by Android 5 (Material Design).~~
- **Done:**
  - `tailwind.config.js`: M3 border-radius scale (`m3-sm/md/lg/xl`) and M3 elevation shadows added.
  - `index.css`: CSS variables `--m3-radius-*`, `--m3-shadow-*`, `--m3-transition`. New `.card`,
    `.card-elevated`, `.surface` utilities. Inter font via Google Fonts.
  - Floating cards upgraded: `ProfileCard`, `ProfileFullModal`, `ContextMenu`, `ReloadPrompt`,
    `InvitePage`, `ServerSidebar` modals, `SettingsPage` API-token modals,
    `ServerSettingsPage` confirm dialogs — all use `bg-discord-popup`, `border-discord-divider/60`,
    `rounded-m3-lg`, and `var(--m3-shadow-3/4)`.
  - `AppShell` user panel container: removed hardcoded `#202024`, uses `bg-discord-user` + M3 shadow.
  - Button hover standardised: `hover:bg-discord-mention/85` replacing all `hover:bg-indigo-500` patterns.
  - Scrollbar updated to M3 palette.

---

**Note:**
- Items 1, 2, 5, 6, 7 remain to be implemented.
- Refer to this guide before making UI/UX changes to ensure consistency with the new direction.
