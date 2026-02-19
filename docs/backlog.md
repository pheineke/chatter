# Project Backlog & Issues

## 1. Known Issues / Bugs
- **Image Attachments Not Rendering**: Currently, image attachments in chat messages are not displayed inline. They need to be rendered as thumbnails or full images within the message bubble.
- **Image Preview Overlay**: Clicking an image attachment should open it in a full-screen or modal overlay for better viewing.

## 2. Feature Requests: User Profiles

### 2.1. Enhanced Profile Data
Users need additional fields to fully customize their identity:
- **Profile Banner**: A customizable background color, static image, or animated GIF that appears at the top of their profile card (e.g., the turquoise area in the reference).
- **Pronouns**: A dedicated text field for pronouns (e.g., "he/him").
- **Bio / Description**: A text area for a short "About Me" description (e.g., "Moin, I'm Joshie...").
- **Online Status**: A consistent indicator (e.g., colored circle: Green/Online, Grey/Offline, Red/DND, Yellow/Idle) displayed next to the avatar.

### 2.2. Interactive Profile Card (Popout)
Clicking a username in the chat or member list should open a "Profile Card" overlay (similar to the screenshot provided).

**Card Layout & Contents:**
1.  **Header (Banner)**:
    -   Displays the user's custom banner color or image.
2.  **Avatar**:
    -   Positioned overlapping the banner and body.
    -   Includes the **Online Status** indicator (e.g., a grey circle for offline, green for online).
3.  **Identity**:
    -   **Display Name**: (e.g., "deaddy") - The visible name.
    -   **Handle / UUID**: (e.g., "joshie_23") - The unique identifier or username handle.
    -   **Pronouns**: Displayed next to the handle or below the name.
4.  **Mutual Connections**:
    -   **Mutual Friends**: Count of shared friends.
    -   **Mutual Servers**: Count of shared servers.
    -   *Tabs/UI*: Ideally displayed as small icons/tabs or summary text.
5.  **About Me (Body)**:
    -   The user's description text (Bio).
    -   Rich text support (optional, e.g., emojis).
6.  **Footer**:
    -   **"Message @Handle" Input**: A quick way to send a Direct Message to this user directly from the card.

## 3. Feature Requests: Voice Chat Improvements

### 3.1. Visual Status Indicators
Enhance the voice participant list to clearly show the status of each user:
-   **Mute Indicator**: Display a "crossed microphone" icon next to the user's name/avatar when their microphone is muted (either self-muted or server-muted).
-   **Deafen Indicator**: Display a "crossed headphones" icon next to the user's name/avatar when they have deafened themselves (disabled output audio).

These icons should update in real-time as the user toggles their state.

### 3.2. Live Streaming Indicator
When a user shares their screen or streams an application:
-   **"LIVE" Badge**: Display a prominent red "LIVE" pill/badge next to the user's name in the voice channel list.
-   **Visibility**: This badge must be visible to all other participants in the channel to indicate active screen sharing.

### 3.3. Self-Status Menu
Clicking on the user's own avatar in the bottom-left "User Panel" (sidebar) should open a status selection menu/popover.
-   **Status Options**:
    -   **Online** (Green)
    -   **Idle** (Yellow)
    -   **Do Not Disturb** (Red)
    -   **Invisible** (Grey)
-   **Custom Status**: Option to set a custom text status (e.g., "In a meeting", "Coding").

### 3.4. Voice Channel Grid View
Clicking on an active voice channel in the sidebar should switch the main content area from the text chat view to a "Voice Grid" view.
-   **Grid Layout**: Display all connected participants as individual tiles (cards) containing their avatar and name.
-   **Stream Separation**: If a user is screen sharing, their stream should appear as a **separate tile**, distinct from their user avatar tile.
-   **Focus/Theater Mode**: Clicking on a stream tile should expand it to fill the available space in the voice channel page, minimizing other tiles to a sidebar or filmstrip.

## 4. Feature Requests: Server & Channel Management

### 4.1. Channel Reordering
-   **Drag-and-Drop**: Users (with appropriate permissions) should be able to drag-and-drop channels to rearrange their order within the sidebar.
-   **Persistence**: The new order must be saved to the backend and reflected for all users in real-time.
-   **Category Support**: Users should also be able to move channels between categories or reorder entire categories.

### 4.2. Unread Channel Indicators
-   **Visual Highlight**: Channels with new unread messages should be displayed with a brighter text color (e.g., white instead of muted grey) in the sidebar to attract attention.
-   **Read State**: The channel should revert to the default muted color once the user views the channel or scrolls to the bottom of the chat.

### 4.3. Channel Member List (Right Sidebar)
-   **Structure**: A collapsible sidebar panel on the right side of the text channel interface.
-   **User Listing**: Displays all members belonging to the current server.
-   **Status Grouping**:
    -   **Online**: Users who are currently connected/online are displayed at the top of the list.
    -   **Offline**: Users who are offline are displayed at the bottom, typically with lower opacity or a greyed-out appearance.
-   **Role Grouping**: (Optional) Users should be grouped by their highest role (e.g., Admin, Moderator, Member) within the Online/Offline sections.


