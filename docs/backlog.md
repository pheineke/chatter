# Project Backlog & Issues

## 1. Known Issues / Bugs

- ~~**Image attachments require page reload for other clients**~~ ✅ Fixed — `upload_attachment` endpoint saved the file and returned the updated message to the uploader but never broadcast a WS event. Other clients had no real-time notification. Fixed by broadcasting `message.updated` (with the full `MessageRead` including the new attachment) to the channel room after the DB commit. The frontend `useChannelWS` already handled `message.updated` by patching the cache in-place.
- ~~**Private (DM) chats do not support attachments**~~ ✅ Fixed — DMs were refactored to use the channel system (`type=dm`); they now render with `MessageInput`/`MessageList`, giving them full attachment support automatically.
- ~~**New server members only appear after page reload**~~ ✅ Fixed — `join_via_invite` (the primary join path) never broadcasted a `server.member_joined` WS event, so existing members never knew someone joined. Fixed by: (1) `invites.py` now broadcasts `server.member_joined` after a new `ServerMember` row is created; (2) `useServerWS` now explicitly handles `server.member_joined/left/kicked` → invalidate `['members']`, and `role.created/updated/deleted` → invalidate both `['roles']` and `['members']` (previously fell through to a default that only invalidated members, leaving the Roles tab stale).
- ~~**Server settings lack a save button**~~ ✅ Fixed — Overview tab now shows a sticky save bar at the bottom whenever name or description differ from the persisted values. Bar has both **Save Changes** and **Discard Changes** buttons. Local state syncs via `useEffect` when the server query data updates (e.g. after another admin edits remotely). Icon and banner changes save immediately on file select (no staging needed).
- ~~**Voice & Video page shows a grey/blank screen**~~ ✅ Fixed — Two separate issues: (1) The main-area router had `<Route path=":serverId" element={<Navigate to="." replace />} />` which redirected to the same URL on every server click, rendering nothing in the main pane (fixed: now shows "Select a channel to start chatting."); (2) The voice grid UI was not implemented — `VoiceGridPane` is now fully built with participant tiles, webcam/screen-share video, speaking indicators, theater mode, and audio/video controls.
- ~~**Server name length is not limited**~~ ✅ Fixed — Capped at 50 characters. Backend: `ServerBase.title` and `ServerUpdate.title` use `Field(min_length=1, max_length=50)` so the API rejects overlong names with a 422. Frontend: `maxLength={50}` added to the Server Name input in Settings and the Create Server modal.
- ~~**Accepting friend requests fails**~~ ✅ Fixed — Re-query with `selectinload` after commit resolves the async relationship loading bug that caused 403s. Pending requests are now split into Incoming (accept/decline) and Outgoing (cancel); a `DELETE /friends/requests/{id}` cancel endpoint was added.
- ~~**Sending a friend request requires a user ID that is not discoverable**~~ ✅ Fixed — The Add Friend form accepts either a username or a UUID. If a plain string is entered, `getUserByUsername` resolves it to an ID before calling `sendFriendRequest`; if it's already a UUID it's used directly. UI shows "No user with that username or ID." on failure.
- ~~**Copy button in invite modal does not work**~~ ✅ Fixed — Copying now uses `navigator.clipboard.writeText` and provides visual feedback.
- ~~**New users receive all roles (including admin) on server join**~~ ✅ Fixed — Root cause was the old `MemberRolePicker` try/catch toggle: the first click always called `assignRole` regardless of current state, making it trivial to accidentally assign the Admin role. The backend `join_server` and `join_via_invite` endpoints never auto-assigned roles. Fixed by: (1) `MemberRolePicker` now reads `member.roles` to determine assigned state before calling assign or remove; (2) `ChannelSidebar` now gates "Create Channel" (background right-click), "Edit Channel", and "Delete Channel" channel context-menu items behind an `isAdmin` check (server owner OR member with an `is_admin` role); (3) `ServerSettingsPage.isAdmin` now checks both `owner_id` and admin role membership instead of owner-only.
- ~~**Users cannot see other participants’ cameras in voice channels**~~ ✅ Fixed — Split `localVideoStream`/`remoteStreams` into separate screen and webcam slots (`localScreenStream`, `localWebcamStream`, `remoteScreenStreams`, `remoteWebcamStreams`). Outgoing tracks tagged with `contentHint` (‘detail’ for screen, ‘motion’ for webcam) so the receiver routes them to the correct slot. Webcam is now always shown in the participant tile independent of screen-sharing state.
- ~~**Users cannot hear each other in voice channels**~~ ✅ Fixed — WebRTC peer connections now correctly exchange audio tracks; AudioContext autoplay policy and ICE candidate queueing resolved.
- ~~**Screen sharing does not work**~~ ✅ Fixed — Rewrote `toggleScreenShare`/`toggleWebcam` with proper `RTCRtpSender` tracking and `onnegotiationneeded`-driven renegotiation; `handleOffer` now handles renegotiation without tearing down the existing peer connection.
- ~~**Voice-connected footer bar goes off-screen**~~ ✅ Fixed — Removed the user listing from the footer bar, resolving the overflow issue.
- ~~**Right-clicking a server icon does not show context menu**~~ ✅ Fixed — Context menu added to server sidebar icons for "Invite to Server" and "Server Settings".
- ~~**Pending invites require a page reload**~~ ✅ Fixed — `create_invite` and `revoke_invite` never broadcast WS events, so the Invites tab was always stale for other admins. Fixed: (1) `create_invite` now broadcasts `invite.created` after commit; (2) `revoke_invite` broadcasts `invite.deleted` before returning; (3) `useServerWS` handles both events by invalidating `['invites', serverId]`; (4) `server.member_joined` also invalidates `['invites']` so the uses counter updates in real time when someone joins via a link.
- ~~**Adding a note to a user in the profile card does not work**~~ ✅ Fixed — The Note input was a disconnected `<input>` stub with no state or API. Built end-to-end: new `user_notes` table (composite PK `owner_id + target_id`), `GET /users/{id}/note` and `PUT /users/{id}/note` endpoints, frontend `getNote`/`setNote` API functions, `useQuery` to load the saved note when the card opens, debounced auto-save (800 ms after last keystroke) with a "Saving…" indicator. Notes are private (visible only to the writer).
- ~~**GIF avatars should only animate on hover**~~ ✅ Fixed — `UserAvatar` now detects `.gif` files and renders a `GifAvatar` component that draws the first frame onto a `<canvas>` (shown by default) and swaps in the animated `<img>` only on hover. The GIF is kept in the DOM while hidden so it loads instantly on first hover.
- ~~**Image resolution for avatars and banners is not limited**~~ ✅ Fixed — `verify_image_magic_with_dims` in `file_validation.py` validates magic bytes (rejects disguised files) and enforces pixel-dimension caps: `AVATAR_MAX = (1024, 1024)`, `BANNER_MAX = (1920, 1080)`, `SERVER_IMAGE_MAX = (1920, 1080)`. Animated GIFs are fully supported — dimensions are checked on the first frame. The saved file extension is now derived from the detected MIME type (not the user-supplied filename) so a GIF is always stored as `.gif` regardless of what the uploader named it.
- ~~**Emoji picker is not implemented**~~ ✅ Fixed — Installed `emoji-mart` + `@emoji-mart/data` + `@emoji-mart/react`. New `EmojiPicker.tsx` portal wraps the dark-themed picker with outside-click and Escape dismissal and viewport clamping. The hover toolbar in `MessageBubble` opens the picker anchored below the button and sends the chosen emoji via `addReaction`. `MessageInput` gained a smiley-face button that opens the picker above the input bar and inserts the chosen emoji at the cursor position.
- ~~**Message replies UI is not implemented**~~ ✅ Fixed — Reply button in hover action bar enters reply mode; right-click context menu also offers Reply (plus Copy Text, Edit, Delete). Reply banner above the input shows author + content preview with ✕ cancel. Replied messages render a quoted header (avatar + username + truncated preview) above the reply body; clicking jumps to & highlights the original. Deleted originals show a tombstone. Works in both server channels and DMs. Escape cancels reply mode.
- ~~**Edited messages show no `(edited)` marker**~~ ✅ Fixed — `is_edited` and `edited_at` fields added to the `Message` model (Alembic migration applied). `edit_message` sets both on save. `MessageRead` schema exposes them. `MessageBubble` shows a muted `(edited)` label after the message content with a tooltip showing the exact edit timestamp.
- ~~**Real-time reactions trigger a full refetch instead of a cache patch**~~ ✅ Fixed — `useChannelWS` now uses `setQueryData` for both `reaction.added` and `reaction.removed`: added reactions are appended with a dedup guard; removed reactions are filtered out by `(user_id, emoji)` pair. No network request is made.
- ~~**DM list has no online status indicator or unread badge**~~ ✅ Fixed — `DMSidebar` now lists all conversations with `UserAvatar` + `StatusIndicator` per contact. An unread white dot appears next to any conversation with messages newer than the stored `dmLastRead` timestamp. A green dot badge also appears on the DM button in `ServerSidebar` (via `useUnreadDMs`) whenever any DM has unread messages, even while on a server.
- ~~**Typing indicator not shown in DMs**~~ ✅ Fixed — `DMPane` now calls `useChannelWS(dmChannel?.channel_id)`, wiring `typingUsers` into the animated "X is typing…" bar and passing `sendTyping` to `MessageInput` via `onTyping`. The backend `/ws/channels/{channel_id}` endpoint already handled `typing` events for all channel types; no backend changes were needed.
- **No notification sound for incoming server channel messages when not in DM sidebar** — `channel.message` handler in `useUnreadDMs` fires `playSound`, but only if the active route is not already the matching channel. Verified working.

## 2. Feature Requests: User Profiles

### ~~2.1. Enhanced Profile Data~~ ✅ Implemented
- **Profile Banner**: Uploadable via `POST /me/banner`; displayed in profile cards.
- **Pronouns**: Stored in `User.pronouns`; shown in profile card and settings.
- **Bio / Description**: `User.description` field; editable in settings, shown on profile card.
- **Online Status**: `StatusIndicator` component shows coloured dot (green/yellow/red/grey) next to avatars throughout the UI; status persists via `User.status` and broadcasts over WS.

### ~~2.2. Interactive Profile Card (Popout)~~ ✅ Implemented
- `ProfileCard` component opens on username/avatar click in chat and member list.
- Shows banner, avatar with status dot, username, pronouns, bio, mutual server count.
- Private note field with debounced auto-save (`GET`/`PUT /users/{id}/note`).
- "Message" input at the bottom opens/navigates to the DM with that user.

## 3. Feature Requests: Voice Chat Improvements

### ~~3.1. Visual Status Indicators~~ ✅ Implemented
- Mute (`mic-off`) and deafen (`headphones-off`) icons appear in red on the right side of each participant row in the voice channel list in `ChannelSidebar`, grouped in a `ml-auto` flex cluster so they're always flush-right.
- Updates in real-time via `voice.state_changed` WS events → `voicePresence` cache invalidation.

### ~~3.2. Live Streaming Indicator~~ ✅ Implemented
- A red **LIVE** pill badge renders to the right of the username in the voice participant row (`ChannelSidebar`) when the participant's `is_sharing_screen` flag is true.
- Badge is visible to all server members viewing the channel list, not just those in the voice channel.

### ~~3.3. Self-Status Menu~~ ✅ Implemented
- Clicking the user panel avatar in both `ChannelSidebar` and `DMSidebar` opens a `ContextMenu` with Online / Away / Do Not Disturb / Offline options.
- Selection calls `PATCH /me` and refreshes the auth context; status dot updates immediately.

### ~~3.4. Voice Channel Grid View~~ ✅ Implemented
- `VoiceGridPane` renders all participants as tiles (webcam feed or avatar, speaking ring, mute indicator).
- Screen-share appears as a separate tile alongside the user tile.
- Clicking any tile enters theater/focus mode; other tiles shrink to a filmstrip sidebar.

## 4. Feature Requests: Server & Channel Management

### ~~4.1. Channel Reordering~~ ✅ Implemented
- Admins drag channel rows to reorder within a category or move to another category (position + `category_id` updated together).
- Admins drag category headers to reorder categories.
- 8 px activation distance so normal clicks still navigate.
- Optimistic cache update with server confirmation via `PUT /servers/{id}/channels/reorder` and `/categories/reorder`; `channels.reordered` / `categories.reordered` WS events keep all clients in sync.
- Non-admins see a read-only ordered list — no drag UI shown.

### ~~4.2. Unread Channel Indicators~~ ✅ Implemented
-   Channels with unread messages display bold white text in the sidebar (`text-discord-text font-semibold`) and a small white dot badge next to the channel name.
-   Both revert to the muted default once the user opens the channel (`markRead` called in `MessagePane`).
-   Server icons show a white dot badge when any channel in that server has unread messages (via `unreadServers` set in `UnreadChannelsContext`, populated by `channel.message` events on the always-on `/ws/me` connection).

### ~~4.3. Channel Member List (Right Sidebar)~~ ✅ Implemented
-   Members sidebar shows all server members grouped by their highest hoisted (coloured) role, with a coloured dot and role-name section header.
-   Online members appear under role groups; offline members in a single “Offline” section at the bottom, all sorted alphabetically.
-   Status updates are real-time via `user.status_changed` WS events; role changes invalidate the member cache via `role.assigned`/`role.removed` WS events. The 30 s poll was removed.
-   `GET /servers/{id}/members` now eagerly loads roles for all members in one query and returns them sorted by position.
-   `ServerSettingsPage` → Members tab `MemberRolePicker` now shows each role as assigned (highlighted with role colour) or unassigned, with explicit assign/remove actions.

### ~~4.4. Spam / Rate-Limit Protection~~ ✅ Implemented
Two-level protection prevents message flooding:

**Global backend default (`.env`)**
-   `RATELIMIT_ENABLED`, `RATELIMIT_MESSAGES`, `RATELIMIT_WINDOW_SECONDS` in `.env`.
-   Token/leaky-bucket counter keyed by user ID; applies before per-channel slowmode checks.
-   Returns HTTP `429 Too Many Requests` with a `Retry-After` header; frontend surfaces a "Slow down!" notice.

**Per-channel slowmode (Channel Settings → Edit Channel)**
-   `slowmode_delay` column (`INT NOT NULL DEFAULT 0`) added to `channels` table (Alembic migration `e5f6a7b8c9d0`).
-   Enforced in `send_message` with an in-memory `_slowmode_last` dict (channel_id → user_id → monotonic timestamp).
-   Configurable options: Off, 5s, 10s, 15s, 30s, 1 min, 2 min, 5 min, 10 min, 1 hour.
-   Backend returns `429` with `detail` and `Retry-After` header when a user sends too soon.
-   `ChannelSidebar` edit modal includes a Slowmode dropdown (admins only).
-   `MessageInput` shows a yellow countdown banner + disabled textarea/send button for the duration of the cooldown; client-side countdown starts immediately on success (no round-trip needed), and a server `429` also triggers the cooldown via the `Retry-After` header.

### ~~4.5. Per-Server Word / Phrase Blocklist~~ ✅ Implemented
-   Server admins manage a blocklist in **Server Settings → Word Filters**.
-   Each entry has a **pattern** (plain phrase or wildcard, e.g. `bad*`) and an **action**: **delete** (reject with a generic error), **warn** (reject with an explanatory message), **kick** (reject + kick the sender), or **ban** (reject + kick + record a permanent ban).
-   Matching is case-insensitive; wildcards use `fnmatch` (`*` / `?`) checked per-word; plain phrases are substring-searched.
-   Enforcement runs in `send_message` before the message is persisted — the message is never stored.
-   New **Bans** tab in server settings lists all banned users with an **Unban** button; admins can also manually ban via `POST /servers/{id}/bans/{user_id}`.
-   Ban check added to both `join_server` and `join_via_invite` so banned users cannot rejoin.
-   DB: `word_filters` table (`id`, `server_id`, `pattern`, `action`, `created_at`) + `server_bans` table (`server_id`, `user_id`, `reason`, `banned_at`). Migration `m5n6o7p8q9r0`.

### ~~4.6. Per-Channel Permission Overrides per Role~~ ✅ Implemented
-   Admins open **Edit Channel → Permissions** tab (new tab in the channel edit modal).
-   Each server role is shown as a row; the 6 most relevant permissions (View, Send, Manage, Attach, React, @all) are columns.
-   Each cell is a **tri-state toggle** — click to cycle: **— Inherit** (grey) → **✓ Allow** (green) → **✗ Deny** (red).
-   **Save Permissions** button sends `PUT /servers/{id}/channels/{ch}/permissions/{role}` for every role in one batch; a green "Saved!" confirmation appears for 1.5 s.
-   Deny takes precedence over Allow when both bits are set. Setting both to 0 reverts the role to server-wide defaults.
-   Backend was already complete: `channel_permissions` table (`channel_id`, `role_id`, `allow_bits BIGINT`, `deny_bits BIGINT`), `GET` and `PUT` endpoints, and `ChannelPerm` bitfield constants (`VIEW_CHANNEL=1`, `SEND_MESSAGES=2`, … `MANAGE_ROLES=256`). Only the frontend UI was missing.

### ~~4.7. Invite Link Controls~~ ✅ Implemented
-   New `InviteModal` component replaces the old "24 hour invite" inline modals in `ChannelSidebar` and `ServerSidebar`.
-   **Expiry** dropdown: Never, 30 min, 1 h, 6 h, 12 h, 24 h, 7 days.
-   **Max uses** dropdown: Unlimited, 1, 5, 10, 25, 50, 100.
-   "Generate Invite Link" button calls `POST /servers/{id}/invites` with the chosen settings.
-   After generation: shows the full link in a monospace box with a **Copy** button (green "Copied!" feedback for 2 s) and invite metadata (uses / max, expiry timestamp).
-   "Generate a new link with different settings" resets the form without closing the modal.
-   Server Settings → Invites tab gains a **"Create Invite"** button (top-right) that opens `InviteModal`; closing the modal invalidates the `['invites']` query so the table refreshes.

### ~~4.8. Channel Topic / Description in Header~~ ✅ Implemented
- `MessagePane` header shows `# name | topic` (truncated, full text in tooltip) when `channel.description` is set.
- Edit Channel modal in `ChannelSidebar` has a "Channel Topic" textarea (pre-filled, saved via `updateChannel`).

### ~~4.9. Keyboard Shortcuts~~ ✅ Implemented
-   **Ctrl+K** — quick-switcher overlay for jumping to channels, DMs, or servers by name.
-   **Alt+↑ / Alt+↓** — navigate to the previous/next channel in the sidebar.
-   **Ctrl+/** — opens the keyboard shortcuts cheat-sheet dialog (`KeyboardShortcutsDialog`).
-   **Escape** — closes open modals and context menus (via `onClose`/`onMouseDown` guards throughout the UI).

### ~~4.10. Category Collapse~~ ✅ Implemented
-   Clicking a category header in the channel sidebar toggles that category's channels open or closed (collapsed state).
-   Collapsed state is stored in `localStorage` (keyed by `serverId + categoryId`) so it persists across page loads.
-   A chevron icon (▼/▶) is shown on every category header (both admin drag mode and read-only mode).
-   Non-admin members can also collapse categories (purely a local UI preference, no API call needed).
-   The drag-and-drop system in admin mode uses `visibleFlatIds` (collapsed channels excluded), so channels in collapsed categories are not reorderable while hidden.

## 5. Feature Requests: Messaging

### ~~5.1. Message Reactions~~ ✅ Implemented
- Hover action bar in `MessageBubble` opens `EmojiPicker` (emoji-mart, dark theme, viewport-clamped portal) to add a reaction.
- Reaction pills render below message body with emoji + count; current user's reactions are highlighted.
- `+` button on pills opens picker to add more. Clicking an existing pill toggles it.
- WS events `reaction.added` / `reaction.removed` patch the TanStack Query cache in place (no refetch).

### ~~5.2. Reply to Messages~~ ✅ Implemented
See full spec: [`docs/specs/message_replies_spec.md`](specs/message_replies_spec.md)

- **Hover / context-menu** to enter reply mode.
- **Reply banner** above the composer showing "Replying to @Username" with a cancel (✕) button and Escape shortcut.
- Replied messages render a **quoted header** (small avatar + username + truncated preview) above the reply body.
- Clicking the quote **jumps to** the original message with a brief highlight.
- Deleted originals show a tombstone: *"Original message was deleted"*.
- Flat list only — no nested threading.

### ~~5.3. Typing Indicator~~ ✅ Implemented
-   **Server channels**: `useChannelWS` tracks `typing.start` events and exposes `typingUsers`; `MessagePane` renders the "X is typing…" bar and `MessageInput` emits `typing.start` via `sendTyping`.
-   **DMs**: `DMPane` calls `useChannelWS(dmChannel?.channel_id ?? null)`, giving DM conversations the same animated typing bar and outgoing `typing.start` emission as server channels.

### ~~5.4. @mention Autocomplete~~ ✅ Implemented
-   Typing `@` in the message input opens a floating autocomplete list of server members filtered in real-time by the typed prefix.
-   Keyboard navigation: ↑/↓ to move, Enter/Tab to select, Escape to dismiss.
-   The selected member's `@username` is inserted at the cursor position; the picker respects the `serverId` prop (DMs have no server members so no autocomplete is shown there).

### ~~5.5. Message Search~~ ✅ Implemented
-   A search icon button (and Ctrl+F shortcut) in the channel header opens a `SearchPanel` sidebar.
-   Debounced text input (300 ms); results rendered as cards with author avatar, username, timestamp, and truncated content; clicking a result jumps to the message and closes the panel.
-   Backend: `GET /channels/{id}/messages?q=<query>` using SQLite `LIKE` full-text scan; cursor pagination is disabled in search mode.

### ~~5.6. Pinned Messages~~ ✅ Implemented
-   Any member can pin a message via the hover action bar or right-click context menu; admins can unpin from the same menu or from the pins panel.
-   The channel header shows a 📌 button with a count badge; clicking opens `PinnedMessagesPanel` listing all pinned messages with jump-to links.
-   Backend: `pinned_messages` join table with `channel_id`, `message_id`, `pinned_at`, `pinned_by`. WS events `message.pinned` / `message.unpinned` broadcast to the channel room.

### ~~5.7. Paginated / Batch Message Loading~~ ✅ Implemented
-   `MessageList` uses `useInfiniteQuery` with cursor-based pagination (`before=<message_id>`, `limit=50`).
-   Intersection observer fires `fetchNextPage` when the top sentinel scrolls into view; scroll position is preserved during prepend via `useLayoutEffect`.
-   "You've reached the beginning of this channel" indicator shown when no more pages exist.

### ~~5.8. Markdown Rendering in Messages~~ ✅ Implemented
-   `marked` v17 + DOMPurify pipeline in `utils/markdown.ts`; `renderMarkdown(text)` parses Discord-flavoured markdown and sanitises through a strict tag/attr allowlist.
-   Supported: **bold**, *italic*, ~~strikethrough~~, inline code, fenced code blocks, blockquotes, lists, external links (new tab), `@mention` spans, `||spoiler||` (click to reveal).
-   `MarkdownContent.tsx` renders via `dangerouslySetInnerHTML`; spoiler reveal uses React event delegation (no `onclick` attrs — DOMPurify strips those).
-   CSS in `index.css`: `.discord-markdown`, `.spoiler`, `.spoiler.revealed`, `.md-link`.

### 5.9. Inline Image / URL Embeds
-   When a message contains a bare image URL (`.png`, `.jpg`, `.gif`, `.webp`) that is the only content or is on its own line, render an inline image preview below the message text.
-   For non-image URLs, show an **Open Graph embed card** (title, description, thumbnail) fetched via a server-side proxy endpoint (`GET /meta?url=<url>`) to avoid CORS issues and prevent IP leaking.
-   Embeds are dismissible per-message (stored in `localStorage`).
-   Cap image previews at 400 px wide / 300 px tall; clicking opens the full image in a lightbox.

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

### ~~7.1. Sound Effects Integration~~ ✅ Implemented
- `useSoundManager` hook manages playback with per-sound enable/disable flags and a master volume stored in `localStorage`.
- **Events covered**: connect (join), disconnect (leave), mute, unmute, deafen, undeafen, new message notification.
- Voice events fire from `useVoiceChannel` on self-mute/deafen/connect/disconnect; `useUnreadDMs` fires `notificationSound` on incoming DMs.
- Settings → Audio section exposes individual toggles for each sound key plus a master volume slider.

## 8. Feature Requests: Security & Privacy

### ~~8.1. DM Restrictions~~ ✅ Implemented
-   `DMPermission` enum (`everyone` / `friends_only` / `server_members_only`) stored on `User`.
-   `GET /dms/{user_id}/channel` enforces the target's preference: checks accepted friendship or shared server membership before creating/returning the DM channel; block check runs first.
-   Settings → Privacy & Safety tab exposes three radio options that `PATCH /me` immediately.

### ~~8.2. Block User~~ ✅ Implemented
-   Block/unblock buttons in `ProfileCard` via `useBlocks` hook (`POST /users/{id}/block`, `DELETE /users/{id}/block`).
-   Blocked users' messages are hidden with a "Blocked message" placeholder and a "Show message" toggle; blocked users cannot open a DM with the blocker.
-   Block list accessible from account settings.

### ~~8.3. Input Sanitization & XSS Protection~~ ✅ Implemented
-   All message HTML is rendered via `renderMarkdown()` which passes output through `DOMPurify.sanitize()` with a strict ALLOWED_TAGS/ALLOWED_ATTR allowlist before `dangerouslySetInnerHTML` insertion.
-   Display names, server names, channel descriptions, and bios are rendered as React text nodes — inherently XSS-safe.
-   `onclick` attrs are stripped by DOMPurify; spoiler interactivity uses React event delegation instead.

### 8.4. Auth Token Rotation & Invalidation
-   JWT access tokens are short-lived; refresh tokens are issued alongside and rotated on every use.
-   All refresh tokens for a user are invalidated on explicit logout or when suspicious activity is detected (e.g. token reuse).
-   A user can view and revoke all active sessions from account settings.

### ~~8.5. File Upload MIME Type Validation~~ ✅ Implemented
-   `verify_image_magic` / `verify_image_magic_with_dims` in `file_validation.py` inspects magic bytes and rejects disguised files.
-   Pixel-dimension caps enforced: avatars 1024×1024, banners & server images 1920×1080.
-   Extension on saved file is derived from detected MIME type (not user-supplied filename).

### ~~8.6. Hide Online Status~~ ✅ Implemented
-   Users can hide their online status — they appear offline to all other users.
-   Toggle in Settings → Privacy & Safety → Presence section.
-   Backend: `hide_status` boolean column on `users` (migration `k3l4m5n6o7p8`). When `True`, `broadcast_presence` always sends `offline` to servers/friends; `GET /users/{id}` and member-list responses mask status as `offline` for other viewers.
-   The user's own status indicator in their panel is unaffected (shows real status).

### 8.7. End-to-End Encryption for Private DMs
-   DM messages between two users are encrypted client-side before being sent to the server, so the server never has access to plaintext content.
-   **Key exchange**: Use the X25519 Diffie-Hellman algorithm. Each client generates a persistent key pair (stored locally, e.g. in IndexedDB). The public key is published to the server and retrievable by the other party.
-   **Message encryption**: Derive a shared secret via X25519, then encrypt each message with XChaCha20-Poly1305 (or AES-GCM). A random nonce is generated per message and stored alongside the ciphertext.
-   **Server role**: The server stores and relays only ciphertext + nonce + sender public key metadata — it cannot read message content.
-   **Key verification**: Users can optionally compare key fingerprints out-of-band (shown in the DM header) to guard against server-level MITM attacks.
-   **Key rotation**: Users can regenerate their key pair in settings; old messages encrypted with the previous key become unreadable (no history re-encryption).
-   **Fallback**: If the recipient's public key is unavailable (e.g. new account, cleared storage), display a clear warning instead of sending plaintext.
-   Implement using the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) or a well-audited library such as `libsodium.js`.

### ~~8.8. Profile Update Rate Limiting~~ ✅ Implemented
-   `app/utils/rate_limiter.py` — sliding-window `RateLimiter`; two shared instances: `image_limiter` (2 / 10 min) and `profile_limiter` (5 / 10 min).
-   `POST /me/avatar` and `POST /me/banner` check `image_limiter`; `PATCH /me` checks `profile_limiter` when description or pronouns are being updated.
-   All three return HTTP `429` with `Retry-After` header on breach; frontend surfaces the detail string in the profile error banner.

### ~~8.9. Change Password~~ ✅ Implemented
-   `POST /users/me/change-password` — verifies current password hash, enforces ≥ 8 char minimum, hashes and stores the new password; returns 204.
-   `changePassword(currentPassword, newPassword)` API helper in `users.ts`.
-   Settings → My Account → **Change Password** section: current / new / confirm inputs, client-side validation, loading state, inline error and 4-second success toast. Existing sessions remain valid after the change.

## 10. UI & Responsiveness

### 10.1. Mobile / Responsive Layout
-   The app is currently desktop-only — sidebars are fixed-width and overflow on narrow viewports.
-   **Target breakpoints**: ≥1024 px (desktop, current layout), 768–1023 px (tablet, hide member list by default), <768 px (mobile, show only one pane at a time with swipe/back navigation).
-   Mobile changes:
    -   Server sidebar collapses to a bottom tab bar or a swipeable drawer.
    -   Channel sidebar slides in over the main pane (hamburger icon in channel header to open).
    -   Member list is hidden by default; accessible via a toolbar icon.
    -   Message input uses `type="text"` with appropriate `inputmode` for mobile keyboards.
-   No native shell required — responsive CSS + React state is sufficient for a PWA-style experience.

### ~~9.1. Per-Channel & Per-Server Notification Settings~~ ✅ Implemented
-   Three levels: **All Messages**, **Mentions Only**, **Mute**. Stored in `user_channel_notification_settings` and `user_server_notification_settings` tables (migration `l4m5n6o7p8q9`).
-   REST: `GET /me/notification-settings`, `PUT /me/notification-settings/channels/{id}`, `PUT /me/notification-settings/servers/{id}`.
-   `useNotificationSettings` hook wraps TanStack Query with optimistic updates and 60-second stale time.
-   Right-clicking any channel (admin or member) shows a notification sub-menu with check-mark on current level; muted channels display 🔕 in the sidebar.
-   `useServerWS` and `useUnreadDMs` skip sound/unread notifications when `channelLevel(id) === 'mute'`.

### 9.2. Browser / Desktop Push Notifications
-   When the browser tab is in the background or minimised, qualifying messages (per the user's per-channel settings) trigger a native browser `Notification` via the [Web Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API).
-   **Permission flow**: On first notification-worthy event after login, the app requests `Notification.requestPermission()`. If denied, a dismissible banner explains how to re-enable it in the browser.
-   Notification content: sender avatar (via `icon`), sender display name + channel/server context as title, truncated message body.
-   Clicking the notification focuses the tab and navigates to the relevant channel.
-   Controlled by a toggle in Settings → Notifications: "Enable desktop notifications".
-   No notification is shown if the tab is already focused and the user is in the relevant channel.

### ~~9.3. Do Not Disturb (DND) Mode Integration~~ ✅ Implemented
-   When a user's status is set to **Do Not Disturb**, notification sounds (`notificationSound`, `callSound`) are suppressed in `useSoundManager.playSound()`.
-   Other voice sounds (mute, deafen, connect, disconnect) still play in DND — they are local-action feedback, not interruptions.
-   A 🔕 bell-off icon appears in both the server and DM sidebar user panels while DND is active, making the silenced state visible.
-   The tab badge (9.4) also respects DND.

### ~~9.4. Notification Badge on Browser Tab (Favicon & Title)~~ ✅ Implemented
-   Browser tab title is prefixed with the unread count: `(N) Chat`.
-   A canvas-drawn favicon displays a red dot badge when there are unread messages.
-   Badge and title clear when all unreads are dismissed.
-   Respects DND: no badge update while the user's status is Do Not Disturb.
-   `useTabBadge(count, isDND)` hook called from `AppShell` using `unreadChannels.size + (hasUnreadDMs ? 1 : 0)` as the count.