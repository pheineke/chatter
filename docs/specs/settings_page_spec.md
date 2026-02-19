# Settings Page Specification

## 1. Overview
The Settings Page is a full-screen overlay that allows users to configure account details, application appearance, and media devices. It mimics the "Discord" settings layout with a sidebar on the left and content on the right.

## 2. Navigation Structure (Sidebar)
The sidebar is divided into categories. Clicking a tab updates the main content area.

### Group 1: User Settings
- **My Account** (Default)

### Group 2: App Settings
- **Appearance**
- **Voice & Video**

### Footer / Bottom Actions
- **Log Out** (Destructive action)
- **Close Button** (X) located at the top-right or adjacent to the sidebar to return to the app.

---

## 3. Page Specifications

### 3.1. User Settings: My Account
**Goal:** Manage identity and public profile.

**Features:**
- **Profile Preview Card:**
  - Displays current Banner (color/image/GIF), Avatar, and Display Name.
  - **Edit User Profile Button:** Triggers modal or inline editing state.
- **Account Information:**
  - **Username:** Display current. Button to "Edit".
  - **Display Name:** Display current. Button to "Edit".
  - **Email:** Masked display (e.g., `s***@gmail.com`). Button to "Edit" (Reveal/Change).
- **Profile Customization:**
  - **Avatar:** Upload new image / Remove current.
  - **Description (About Me):** Text area to set a custom bio.

### 3.2. App Settings: Appearance
**Goal:** Customize the visual interface.

**Features:**
- **Theme Presets:**
  - Radio selection: **Dark** (Default), **Light**.
- **Custom Coloring (Simple):**
  - **Primary Color Picker:** Overrides the main brand color (buttons, active states).
  - **Background Color Picker:** Overrides standard background colors.
- **Advanced Customization (CSS):**
  - *Warning label about safety.*
  - **Custom CSS:** Large text area to paste raw CSS.
  - **Upload CSS File:** Button to load a `.css` file's content into the text area.
  - **Apply/Reset Buttons:** To save or revert changes.

### 3.3. App Settings: Voice & Video
**Goal:** Configure hardware for WebRTC calls and sound notifications.

**Features:**
- **Voice Settings:**
  - **Input Device (Microphone):** Dropdown list of available input devices.
  - **Output Device (Speakers):** Dropdown list of available output devices (if browser supports `setSinkId`, otherwise denote "System Default").
  - **Input Volume:** Slider (0-100%) to control software gain or local mic constraint.
  - **Output Volume:** Slider (0-100%) to control global incoming audio volume.
- **Mic Test:**
  - **"Let's Check" Button:** Starts a loopback test.
  - **Visualizer:** Bar graph showing input levels in real-time.
- **Video Settings:**
  - **Camera:** Dropdown list of available video devices.
  - **Video Preview:** Live feed box showing the selected camera input.
- **Sound Settings:**
  - **Disconnect Sound:** Toggle to enable/disable sound when a user disconnects from voice chat.
  - **Connecting Sound:** Toggle to enable/disable sound when a user connects to voice chat.
  - **Deafen Sound:** Toggle to enable/disable sound when deafening.
  - **Undeafen Sound:** Toggle to enable/disable sound when undeafening.
  - **Mute Sound:** Toggle to enable/disable sound when muting.
  - **Unmute Sound:** Toggle to enable/disable sound when unmuting.

### 3.4. Log Out
**Goal:** Securely end the session.

- **Action:** Clears local auth tokens (JWT).
- **Redirection:** Sends user back to `/login`.
- **Confirmation:** (Optional) Modal asking "Are you sure?" before logging out.

## 4. Technical Considerations
- **State Management:**
  - "My Account" updates require backend API calls (`PATCH /users/me`).
  - "Appearance" settings should persist in `localStorage` to apply immediately on reload.
  - "Voice & Video" device IDs must be stored in `localStorage` and re-applied when joining calls (using `navigator.mediaDevices`).
- **Permissions:**
  - Accessing the "Voice & Video" tab should trigger a permission prompt (`getUserMedia`) if permissions aren't already granted, to allow device enumeration.
