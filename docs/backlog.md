# Project Backlog & Issues

## 1. Known Issues / Bugs

- **Image attachments require page reload for other clients** — When a user sends an image attachment, other connected clients do not see it in real-time and must reload the page.
- **Private (DM) chats do not support attachments** — File/image attachment sending is missing from DM conversations.
- **New server members only appear after page reload** — When a user joins a server, existing members do not see the new member in the member list until they refresh.
- **Server settings lack a save button** — Changes made in server settings are not persisted; a save/confirm button needs to be added.
- **Voice & Video page shows a grey/blank screen** — Navigating to the voice/video page renders an empty grey page instead of the expected UI.
- **Server name length is not limited** — There is no maximum length enforced on server names; a reasonable cap should be added.
- **Friend requests do not work** — Sending a friend request fails, likely because the form requires a user ID but users have no way to find their own ID. The user ID should be visible on the profile card.
- **Copy button in invite modal does not work** — Clicking the copy button in the invite link modal has no effect.
- **New users receive all roles (including admin) on server join** — Every new member is incorrectly assigned all existing roles. New members should receive no roles by default unless a role is explicitly configured to be assigned on join.
- ~~**Users cannot see other participants' cameras in voice channels**~~ ✅ Fixed — Camera streams use the same WebRTC renegotiation pipeline as screen sharing; `remoteStreams` is updated via `ontrack` and rendered as a webcam tile in `VoiceGridPane`.
- ~~**Users cannot hear each other in voice channels**~~ ✅ Fixed — WebRTC peer connections now correctly exchange audio tracks; AudioContext autoplay policy and ICE candidate queueing resolved.
- ~~**Screen sharing does not work**~~ ✅ Fixed — Rewrote `toggleScreenShare`/`toggleWebcam` with proper `RTCRtpSender` tracking and `onnegotiationneeded`-driven renegotiation; `handleOffer` now handles renegotiation without tearing down the existing peer connection.
- ~~**Voice-connected footer bar goes off-screen**~~ ✅ Fixed — Removed the user listing from the footer bar, resolving the overflow issue.
- **Right-clicking a server icon does not show context menu** — Right-clicking the server icon in the sidebar should open a context menu with options for "Invite to Server" and "Server Settings".
- **Adding a note to a user in the profile card does not work** — The note field in the profile card popout does not save or persist user notes.
- **GIF avatars should only animate on hover** — Animated GIF user avatars should display as a static frame by default and only play the animation when hovering over the user's avatar in chat messages or the profile card.
- **Image resolution for avatars and banners is not limited** — Currently, server/profile avatars and banners can be uploaded at any resolution. These should be constrained (e.g., max 1024x1024 for avatars, 1920x1080 for banners) to optimize storage and bandwidth.

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

### 4.4. Spam / Rate-Limit Protection
Two-level protection to prevent message flooding:

**Per-server (Server Settings UI)**
-   Optional slowmode toggle per server (or per channel).
-   Configurable cooldown: minimum milliseconds a user must wait between messages.
-   Stored as a server/channel setting and enforced on the backend for every message send in that server/channel.

**Global backend default (`.env`)**
-   `RATELIMIT_ENABLED` — toggle global rate limiting on/off.
-   `RATELIMIT_MESSAGES` — message quota per window (e.g. `10`).
-   `RATELIMIT_WINDOW_SECONDS` — rolling window size in seconds (e.g. `5` → max 10 messages per 5 s per user).
-   Implemented as a token/leaky-bucket counter keyed by user ID, applied before any per-server slowmode checks.
-   Returns HTTP `429 Too Many Requests` with a `Retry-After` header when the quota is exceeded; the frontend should surface a friendly "Slow down!" notice.

**Attack example (what this must prevent)**

The following script, runnable from a browser console or any JS environment, demonstrates how an authenticated user can trivially flood a channel at ~20 requests/second with no current server-side resistance. Credentials redacted.

```js
const url = "http://<host>:5173/api/channels/<channel-id>/messages";
const token = "<jwt-token>";

let running = true;

function randomString(length = 6) {
    const chars = "abcdefghijklmnopqrstuvwxyz";
    return Array.from({ length }, () =>
        chars[Math.floor(Math.random() * chars.length)]
    ).join("");
}

async function spamLoop() {
    while (running) {
        fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                content: randomString(),
                reply_to_id: null
            })
        }).catch(() => {});

        // 50 ms delay → ~20 req/sec
        await new Promise(r => setTimeout(r, 50));
    }
}

spamLoop();
```

At 50 ms per request this produces ~20 messages/second, ~1 200/minute — the rate limiter must reject this well before the database or WebSocket fan-out become a bottleneck.

### 4.5. Per-Server Word / Phrase Blocklist
-   Server admins can maintain a list of blocked words or phrases in server settings.
-   Each entry has a configurable action: **delete** (silently remove the message), **warn** (DM the user), **kick**, or **ban**.
-   Matching is case-insensitive; support simple wildcard patterns (e.g. `bad*`).
-   Changes take effect immediately without restarting the server.

### 4.6. Per-Channel Permission Overrides per Role
-   In addition to server-wide role permissions, admins should be able to override specific permissions (read, write, manage messages, etc.) for a given role on a per-channel basis.
-   Overrides are additive or restrictive and take precedence over the server-wide role value.
-   Displayed in channel settings under a "Permissions" tab showing each role with allow/deny/inherit toggles per permission.

### 4.7. Invite Link Controls
-   When creating an invite link, users can optionally set:
    -   **Expiry** — never, 30 min, 1 h, 6 h, 12 h, 1 day, 7 days.
    -   **Max uses** — unlimited or a fixed cap (1, 5, 10, 25, 50, 100).
-   Server admins can see all active invite links in server settings, and can **pause** (temporarily disable) or **revoke** (delete) any link.
-   Expired or fully-used links return a clear error on the invite page.

## 5. Feature Requests: Messaging

### 5.1. Message Reactions
See full spec: [`docs/specs/message_reactions_spec.md`](specs/message_reactions_spec.md)

- **Hover action bar** (😊＋ icon) or right-click context menu opens the emoji picker.
- **Full emoji picker** — category nav bar, search, recently used (last 36), skin tone selector, 36×36 px grid with name tooltip.
- **Reaction pills** below message body — emoji + count, highlighted if current user reacted, ＋ add button.
- **Hover tooltip** — shows "Liked by Josh, Anna, and 3 more" after 400 ms delay.
- **Right-click a pill** — opens a persistent Reactors Popover with full scrollable list of avatars + names.
- WebSocket events `reaction.added` / `reaction.removed` for real-time pill updates.

### 5.2. Reply to Messages
See full spec: [`docs/specs/message_replies_spec.md`](specs/message_replies_spec.md)

- **Hover / context-menu** to enter reply mode.
- **Reply banner** above the composer showing "Replying to @Username" with a cancel (✕) button and Escape shortcut.
- Replied messages render a **quoted header** (small avatar + username + truncated preview) above the reply body.
- Clicking the quote **jumps to** the original message with a brief highlight.
- Deleted originals show a tombstone: *"Original message was deleted"*.
- Flat list only — no nested threading.

### 5.3. Paginated / Batch Message Loading
-   **Initial load**: When a user opens a text channel, the most recent **100 messages** are fetched in a single request.
-   **Pagination chunks**: Scrolling up towards older messages fetches the next **50 messages** at a time (cursor-based, using the oldest visible message ID as the `before` cursor).
-   **Configurable chunk size**: The page size for subsequent loads (default 50) is a per-server setting, adjustable by admins in server settings (e.g. 25 / 50 / 100). The initial load size (100) can also be made configurable via a server setting.
-   **Backend**: The messages endpoint accepts `before=<message_id>` and `limit=<n>` query parameters. `limit` is capped at a server-wide maximum (e.g. 200) to prevent abuse.
-   **Frontend**: Infinite-scroll trigger fires when the user scrolls within ~200 px of the top of the message list; a loading spinner is shown while the request is in flight. Already-loaded messages are prepended without resetting the scroll position.
-   **No more messages**: When the API returns fewer items than requested, the "load more" trigger is disabled and an "Beginning of channel" indicator is shown.

## 6. Feature Requests: Bot / API Access

### 6.1. Personal API Tokens & Bot Support
See full spec: [`docs/specs/bot_api_spec.md`](specs/bot_api_spec.md)

- Users can generate **named personal API tokens** (max 5) in account settings.
- Tokens authenticate via `Authorization: Bot <token>` header on all existing REST endpoints.
- Token is shown **once** at creation (SHA-256 hashed in DB, never stored raw).
- Bots can send/read messages, list servers/channels/members, and send DMs.
- Optional **WebSocket gateway** for real-time events (`message_create`, `message_delete`, etc.).
- **"API Tokens" tab** in account settings — create, copy (one-time reveal), and revoke tokens.
- Python `httpx` / `requests` example in spec.

## 7. Feature Requests: Client Sounds

### 7.1. Sound Effects Integration
See full spec: [`docs/specs/client_sounds_spec.md`](specs/client_sounds_spec.md)

- Implement a global sound manager to play notification sounds.
- **Events**:
  - Join/Leave channel (self & others)
  - Mute/Unmute (self)
  - Deafen/Undeafen (self)
  - Incoming Message (when not focused)
- **Settings**: Respect user preferences for toggling individual sounds.
- **Assets**: Use provided `frontend/public/sounds/` files.

## 8. Feature Requests: Security & Privacy

### 8.1. DM Restrictions
-   Users can restrict who may send them direct messages: **everyone**, **friends only**, or **server members only** (users sharing at least one server).
-   Attempts from disallowed users return a clear error rather than silently failing.
-   Configurable in user account settings under a "Privacy" tab.

### 8.2. Block User
-   A user can block another user from their profile card or message context menu.
-   Effects: blocked user cannot send DMs; their messages in shared servers are hidden/collapsed with an expandable "Blocked message" placeholder.
-   Block list is manageable from account settings.

### 8.3. Input Sanitization & XSS Protection
-   All user-supplied content rendered in the frontend (messages, display names, server names, bios, etc.) must be sanitized before insertion into the DOM.
-   Use a well-maintained library (e.g. DOMPurify) for any HTML rendering path.
-   Backend should also strip or reject payloads containing dangerous HTML/script tags.

### 8.4. Auth Token Rotation & Invalidation
-   JWT access tokens are short-lived; refresh tokens are issued alongside and rotated on every use.
-   All refresh tokens for a user are invalidated on explicit logout or when suspicious activity is detected (e.g. token reuse).
-   A user can view and revoke all active sessions from account settings.

### 8.5. File Upload MIME Type Validation
-   File uploads are validated by inspecting the actual file signature (magic bytes), not just the file extension or `Content-Type` header.
-   Disguised executables (e.g. a `.png` that is actually a PE binary) are rejected with a `400` error.
-   Allowed MIME types are defined in a server-side allowlist (images, common document formats, etc.).

### 8.6. Hide Online Status
-   Users can choose to hide their online status from non-friends so they appear offline to everyone except their friend list.
-   This preference is stored in account settings and respected by all presence-broadcast WebSocket events.

### 8.7. End-to-End Encryption for Private DMs
-   DM messages between two users are encrypted client-side before being sent to the server, so the server never has access to plaintext content.
-   **Key exchange**: Use the X25519 Diffie-Hellman algorithm. Each client generates a persistent key pair (stored locally, e.g. in IndexedDB). The public key is published to the server and retrievable by the other party.
-   **Message encryption**: Derive a shared secret via X25519, then encrypt each message with XChaCha20-Poly1305 (or AES-GCM). A random nonce is generated per message and stored alongside the ciphertext.
-   **Server role**: The server stores and relays only ciphertext + nonce + sender public key metadata — it cannot read message content.
-   **Key verification**: Users can optionally compare key fingerprints out-of-band (shown in the DM header) to guard against server-level MITM attacks.
-   **Key rotation**: Users can regenerate their key pair in settings; old messages encrypted with the previous key become unreadable (no history re-encryption).
-   **Fallback**: If the recipient's public key is unavailable (e.g. new account, cleared storage), display a clear warning instead of sending plaintext.
-   Implement using the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) or a well-audited library such as `libsodium.js`.

### 8.8. Profile Update Rate Limiting
-   Users are limited in how frequently they can update their profile (avatar, display name, bio, banner, etc.) to prevent abuse (e.g. rapid avatar cycling to evade bans or spam notifications).
-   **Default limits** (configurable via `.env`):
    -   Avatar / banner image: max **2 updates per 10 minutes** per user.
    -   Display name / bio / pronouns: max **5 updates per 10 minutes** per user.
-   Enforced on the backend; exceeding the limit returns HTTP `429 Too Many Requests` with a `Retry-After` header indicating when the next update is allowed.
-   The frontend should surface a clear message such as "You're updating your profile too quickly. Please wait X seconds."