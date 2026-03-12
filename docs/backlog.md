# Project Backlog & Issues

---

## Priority Ranking

Issues ranked by **impact × urgency**. Priorities: 🔴 P0 Critical · 🟠 P1 High · 🟡 P2 Medium · 🟢 P3 Polish

### 🔴 P0 — Critical (security / data loss / broken core)

| # | Issue | Area |
|---|-------|------|
| 1 | ✅ **Channel WS has no membership/access check** — any authed user can spy on any channel's event stream | Security |
| 2 | ✅ **No rate limiting on `/auth/register` or `/auth/login`** — open to brute force & account enumeration | Security |
| 3 | ✅ **Text content of attachment messages is not E2EE** — plaintext sent/stored when a file is attached | Security |
| 4 | ✅ **Editing an E2EE message shows raw ciphertext** in the edit field | Security / UX |
| 5 | ✅ **Word-filter "warn" error leaks the exact regex pattern** — lets users trivially bypass filters | Security |
| 6 | ✅ **`UserRead` leaks `preferred_status` and `hide_status`** — private fields visible to any caller | Security |
| 7 | ✅ **No minimum password length at registration** — `UserCreate` schema has no password validator | Security |
| 8 | ✅ **Typed text is cleared before `sendMut` resolves** — message permanently lost if server rejects it | Data loss |

### 🟠 P1 — High (broken feature / significant UX regression)

| # | Issue | Area |
|---|-------|------|
| 9 | ✅ **Status indicator updates not propagated to friends in real time** | Real-time |
| 10 | ✅ **`PATCH channel` never broadcasts `channel.updated`** — rename/settings invisible to others | Real-time |
| 11 | ✅ **`PATCH server` never broadcasts** — name/description changes require page reload | Real-time |
| 12 | ✅ **`POST/PATCH categories` have no broadcast** — new/renamed categories invisible in real time | Real-time |
| 13 | ✅ **No notification when a friend request is received or accepted** | UX / Discovery |
| 14 | ✅ **"Server members only" DM setting incorrectly blocks already-friended users** | Bug |
| 15 | ✅ **No feedback when message exceeds 2000-char limit** — message silently vanishes | UX |
| 16 | ✅ **Cannot pin messages in private DMs** | Feature gap |
| 17 | ✅ **`reactMut`, `editMut`, `deleteMut`, `pinMut` all lack `onError`** — failures completely silent | Error handling |
| 18 | ✅ **No rate limiting on friend requests, reactions, or DM channel creation** | Security / DoS |
| 19 | ✅ **Friends/pending list lags** — full user objects (incl. about-me blob) passed into list rows; no virtualisation | Performance |
| 20 | ✅ **In-memory rate limiter breaks under multiple workers** — each worker gives `N×` the quota | Backend |

### 🟡 P2 — Medium (noticeable, degrades experience)

| # | Issue | Area |
|---|-------|------|
| 21 | **`MessageInput` and edit textarea have no `maxLength`** — no proactive cap at UI level | UX |
| 22 | **Message input stays expanded after sending a long message** — doesn't reset height | UX |
| 23 | **DM header username/avatar not clickable to open full profile** | UX |
| 24 | **About Me has no character limit** — no `max_length=2000` on backend or frontend counter | UX |
| 25 | **About Me text does not wrap** — overflows horizontally | UX |
| 26 | **Accept/Decline buttons hidden with `opacity-0`** — inaccessible to touch/keyboard users | Accessibility |
| 27 | **Clicking timestamp on follow-up messages opens profile card** — wrong trigger | UX |
| 28 | **`UserPanel` click area is a non-focusable `div`** — should be a `button` | Accessibility |
| 29 | **No `user.updated` WS event for username/avatar changes** — friend lists go stale | Real-time |
| 30 | **Server image/banner uploads emit no WS event** | Real-time |
| 31 | **Status change not broadcast to user's own other open tabs** | Real-time |
| 32 | **DM unread state is device-local only** (`localStorage`) — no cross-device sync | Feature gap |
| 33 | **Silent failure on channel/category creation** — no try/catch, no error toast | Error handling |
| 34 | **`FriendsPane` shows no error state when fetch fails** — empty list with no message | Error handling |
| 35 | **`UserPanel` status-change has no try/catch** — unhandled promise rejection | Error handling |
| 36 | **MessagePane search conflates "no results" with "search error"** | UX |
| 37 | **No list virtualisation in `MessageList`** — DOM grows indefinitely as pages load | Performance |
| 38 | **`MessageBubble` not memoized** — all bubbles re-render on every new WS message | Performance |
| 39 | **`_slowmode_last` dict never pruned** — grows forever in memory | Backend / Memory |
| 40 | **Redundant polling on DM conversations** — `refetchInterval` alongside live WS | Performance |
| 41 | **Voice presence polls every 10 s** — WS already handles join/leave in real time | Performance |

### 🟢 P3 — Polish (low urgency, nice to have)

| # | Issue | Area |
|---|-------|------|
| 42 | **Status icon cutout mask drifts at non-100% zoom** — use top-left anchor or SVG clip | Visual |
| 43 | **Server tab active state: border instead of background tint** | Visual |
| 44 | **E2EE tag placement** — move to timestamp area; lock icon only on follow-up messages | Visual |
| 45 | **DM list items: clicking selects text instead of just the row** — add `select-none` | UX |
| 46 | **Escape / Close settings button is unintuitive** | UX |
| 47 | **"Friend request sent!" never auto-clears** | UX |
| 48 | **"Add friend" form state persists when switching tabs** | UX |
| 49 | **`bubbleRefs` Map grows unboundedly** — no cleanup on unmount | Memory |
| 50 | **Hover state tracked in React state in `MessageBubble`** — use CSS `group-hover` instead | Performance |
| 51 | **`channel.updated` client handler is dead code** — wired up but never fired (fixed by P1-10) | Cleanup |

---

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
- ~~**No notification sound for incoming server channel messages when not in DM sidebar**~~ ✅ Verified working — `channel.message` handler in `useUnreadDMs` fires `playSound`, but only if the active route is not already the matching channel.
- **Escape / Close settings button is unintuitive** — The UX for dismissing the settings page (Escape key and/or close button placement/style) is confusing to users. Needs a clearer affordance.
- **No notification when a friend request is received or accepted** — The recipient only discovers the request/acceptance if they actively navigate to the DM panel (and even then it requires opening the Friends view). There is no badge, toast, or sound to alert them in real time. Idea: add a persistent "Friends" button above the user panel in the sidebar (in the channel card area) that shows a badge count of pending incoming requests, giving it a visible home without requiring navigation to the DM tab.
- **"Server members only" DM privacy setting incorrectly blocks already-friended users** — If a user restricts DMs to mutual-server members, befriended users who don't share a server are also blocked, which is wrong. The setting logic needs a rework. Proposed replacement model (matching Discord's current approach):
  - **Global settings** (apply across all servers):
    - *Direct Messages and Friend Requests* — Allow DMs and friend requests from other server members.
    - *Message Requests* — Filter messages from server members you may not know (lands in a requests inbox rather than being blocked outright).
  - **Per-server overrides** (additional toggles per server, on top of global):
    - *Share my activity* — Share activity information from games and connected apps, including when and how you engage.
    - *Activity joining* — Allow users to join your activity on this server.
  - Friends should always be able to DM regardless of server-membership settings.
- **Text messages with attachments are not end-to-end encrypted** — When a message contains both text and a file attachment the text portion is sent/stored unencrypted. The text content of attachment messages should follow the same E2EE path as plain text messages.
- **Message input box stays expanded after sending a long message** — After the user types a long multi-line message and sends it, the textarea does not shrink back to its default single-line height. It should reset to minimum height on send.
- **Cannot pin messages in private DMs** — The pin action is only available in server channels. DM channels should also support pinned messages (both the pin action on individual messages and a pinned-messages panel).
- **Editing an E2EE message shows the raw ciphertext** — When a user tries to edit one of their own encrypted messages, the edit input is pre-filled with the encrypted ciphertext instead of the plaintext. Fix: decrypt the message client-side before populating the edit field, then re-encrypt the edited plaintext before submitting to the server.
- **Status indicator updates not propagated to friends in real time** — If user A changes their status (e.g. DND → Away), user B continues to see the old status until a page reload. The `presence` WS event (or equivalent) is either not being broadcast to friends/DM participants or not being handled client-side to update the cached user data.
- **DM header username and avatar are not clickable to open full profile** — Clicking the other user's name or avatar in the DM channel header should open their full profile card/page, the same as clicking their avatar in the message list.
- **E2EE tag placement and follow-up message indicator** — The "E2EE" green tag should move from its current position to sit next to the message timestamp. For follow-up messages (no avatar/header repeated), show only the green lock icon next to the timestamp instead of the full "E2EE" label.
- **Clicking the timestamp on follow-up messages opens profile card incorrectly** — On grouped/follow-up messages the timestamp is clickable and opens the sender's profile card, which is unintended. Only clicking the user's avatar should open the profile card; the timestamp area should not be a trigger.
- **Server tab active state: use a border instead of a background tint** — The currently selected server tab uses a background tint to indicate active state. Replace this with a visible border (e.g. outline or inset border on the tab) so the selection is clearer and more distinct from the hover state.
- **"About Me" text on user profiles does not wrap** — Long about-me text overflows horizontally instead of wrapping to the next line. The container needs `word-break: break-word` / `whitespace: pre-wrap` (or equivalent Tailwind classes) so all content stays visible.
- **"About Me" field has no character limit** — There is currently no cap on the about-me field. Limit it to 2000 characters: enforce `max_length=2000` on the backend schema and add a live character counter + input cap on the frontend.
- **DM list items: clicking selects/highlights the text instead of just the row** — When clicking a conversation entry in the DM panel the username text gets selected (text selection highlight) rather than only the row being highlighted as active. Add `select-none` (or `user-select: none`) to the DM list item so only the row background changes on click.
- **Friends/pending list lags when a user has a large about-me or many contacts** — Two separate problems: (1) rendering a user with a very long about-me string (even in a compact list row that doesn't display it) causes noticeable jank — the full user object including the about-me blob is likely being passed down and causing expensive re-renders; the about-me text should not be included in the lightweight list-item payload, only fetched when opening a full profile. (2) The list itself is not virtualised — rendering hundreds or thousands of friend/pending rows at once tanks performance. The friends list should use a virtual scroll (e.g. `react-window` or `react-virtual`) so only the visible rows are in the DOM.
- **No feedback when message exceeds the 2000-character limit** — The backend enforces a 2000-character cap via `MessageBase.sanitize_content` (raises 422). The frontend sends the request regardless and silently swallows the error — the message just disappears with no toast, inline warning, or character counter. Fix: add a live character counter near the input that turns red as the limit approaches, block sending when over the limit, and/or show an error toast when the 422 is returned.

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

### ~~5.9. Inline Image / URL Embeds~~ ✅ Implemented
-   Bare image URLs (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`) in message content render as inline image previews (capped 400×300 px) below the text; clicking opens a lightbox.
-   Other URLs are fetched server-side by `GET /meta?url=<url>` (httpx + OG tag regex) and rendered as an embed card: coloured left border, site name, title, description, thumbnail.
-   `extractURLs()` in `utils/embeds.ts` detects all URLs and classifies them as image or non-image.
-   Embeds are dismissible per-URL per-message via an ✕ button (persisted in `localStorage`).
-   TanStack Query caches OG metadata for 10 minutes; bad URLs / non-HTML responses silently render nothing.
-   Backend `app/routers/meta.py` — streams max 512 KB, fakes a Chrome UA, resolves relative image URLs.

### ~~6.1. Personal API Tokens & Bot Support~~ ✅ Implemented
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

### ~~8.4. Auth Token Rotation & Invalidation~~ ✅ Implemented
-   JWT access tokens are short-lived (15 min); rotating refresh tokens (7-day expiry) are issued at login.
-   Every `/auth/refresh` call revokes the submitted token and issues a fresh pair — replay of a used token revokes all sessions for that user.
-   `User-Agent` header and `last_used_at` timestamp are recorded per session (migration `n6o7p8q9r0s1`).
-   `GET /auth/sessions` lists all active sessions; `DELETE /auth/sessions/{id}` revokes one; `DELETE /auth/sessions` revokes all except the current one.
-   Frontend auto-refresh interceptor in `api/client.ts` transparently retries 401s using the stored refresh token, queuing concurrent requests until the new token arrives.
-   **Settings → My Account → Active Sessions**: shows each session with browser/OS label + last-active time, a per-session Revoke button, and a "Log out all other sessions" bulk action. Current session is marked "This device".

### ~~8.5. File Upload MIME Type Validation~~ ✅ Implemented
-   `verify_image_magic` / `verify_image_magic_with_dims` in `file_validation.py` inspects magic bytes and rejects disguised files.
-   Pixel-dimension caps enforced: avatars 1024×1024, banners & server images 1920×1080.
-   Extension on saved file is derived from detected MIME type (not user-supplied filename).

### ~~8.6. Hide Online Status~~ ✅ Implemented
-   Users can hide their online status — they appear offline to all other users.
-   Toggle in Settings → Privacy & Safety → Presence section.
-   Backend: `hide_status` boolean column on `users` (migration `k3l4m5n6o7p8`). When `True`, `broadcast_presence` always sends `offline` to servers/friends; `GET /users/{id}` and member-list responses mask status as `offline` for other viewers.
-   The user's own status indicator in their panel is unaffected (shows real status).

### ~~8.7. End-to-End Encryption for Private DMs~~ ✅ Implemented
-   DM messages are encrypted client-side with **ECDH P-256 + AES-256-GCM** (Web Crypto API). The server stores and relays only ciphertext + nonce; it never sees plaintext message content.
-   **Key pair**: Each user generates a persistent ECDH P-256 keypair on first use. The public key (SPKI base64) is uploaded to `PUT /me/e2ee-public-key`; the private key is stored in IndexedDB (Dexie) and never leaves the device.
-   **Encryption flow**: On DM send, `encryptForUser(partnerId, plaintext)` derives a shared AES key via ECDH, encrypts with AES-256-GCM (random nonce), and sends `{content: <ciphertext>, nonce, is_encrypted: true}` to the server. On receipt, the reverse is applied in `decryptFromUser`.
-   **Key verification**: The DM header shows a green 🔒 badge with the first 4 bytes of the partner's SHA-256 fingerprint. Full fingerprints are visible in Settings → Privacy & Safety → End-to-End Encryption.
-   **Key rotation**: Settings → Privacy & Safety → Rotate key pair regenerates the keypair and republishes the public key. Old messages encrypted with the previous key become unreadable.
-   **Key backup**: Settings → Privacy & Safety → Download key backup exports a JSON backup file containing the encrypted keypair. Import backup restores it. Backup is tied to the user's ID.
-   **QR login / key transfer**: A new device visits `/qr-login` to display a QR code containing an ephemeral ECDH public key. A trusted device (with the existing keypair) opens Settings → Privacy & Safety → Approve QR login, scans the QR, and the existing private key is encrypted with the ephemeral shared secret and sent to the new device. The server also mints a fresh token pair so the approval doubles as a login.
-   **Backend**: Migration `r0s1t2u3v4w5` adds `qr_sessions` table, `user_e2ee_keys` table, and `is_encrypted`/`nonce` columns to `messages`. New router `app/routers/e2ee.py` handles `POST /auth/qr/challenge`, `GET /auth/qr/{id}/status`, `POST /auth/qr/{id}/approve`, `PUT /me/e2ee-public-key`, `GET /users/{id}/e2ee-public-key`.
-   **Fallback**: If the partner has no public key, messages are sent plaintext with a console warning (no hard block to avoid locking out users whose partner hasn't set up E2EE yet).

### ~~8.8. Profile Update Rate Limiting~~ ✅ Implemented
-   `app/utils/rate_limiter.py` — sliding-window `RateLimiter`; two shared instances: `image_limiter` (2 / 10 min) and `profile_limiter` (5 / 10 min).
-   `POST /me/avatar` and `POST /me/banner` check `image_limiter`; `PATCH /me` checks `profile_limiter` when description or pronouns are being updated.
-   All three return HTTP `429` with `Retry-After` header on breach; frontend surfaces the detail string in the profile error banner.

### ~~8.9. Change Password~~ ✅ Implemented
-   `POST /users/me/change-password` — verifies current password hash, enforces ≥ 8 char minimum, hashes and stores the new password; returns 204.
-   `changePassword(currentPassword, newPassword)` API helper in `users.ts`.
-   Settings → My Account → **Change Password** section: current / new / confirm inputs, client-side validation, loading state, inline error and 4-second success toast. Existing sessions remain valid after the change.

## 10. UI & Responsiveness

### ~~10.1. Mobile / Responsive Layout~~ ✅ Implemented
-   **≥ 768 px (tablet/desktop)**: sidebars are static in-flow columns — layout unchanged.
-   **< 768 px (mobile)**: server icons column + channel/DM list column collapse into a single compound left-panel **slide-in drawer** (z-40, `translate-x` driven).
    -   A hamburger ☰ button (`md:hidden`) appears at the left of every main-pane header (channels, DMs, Friends) to open the drawer.
    -   Tapping the backdrop (semi-transparent overlay, z-30) or navigating to any route auto-closes the drawer via a `useEffect([location.pathname])` in `AppShell`.
    -   Member list sidebar and its toggle button are hidden on mobile (`hidden md:flex` / `hidden md:block`) — no member panel cramping the message area.
-   No native shell required — pure Tailwind responsive classes + React state in `AppShell`.

### ~~9.1. Per-Channel & Per-Server Notification Settings~~ ✅ Implemented
-   Three levels: **All Messages**, **Mentions Only**, **Mute**. Stored in `user_channel_notification_settings` and `user_server_notification_settings` tables (migration `l4m5n6o7p8q9`).
-   REST: `GET /me/notification-settings`, `PUT /me/notification-settings/channels/{id}`, `PUT /me/notification-settings/servers/{id}`.
-   `useNotificationSettings` hook wraps TanStack Query with optimistic updates and 60-second stale time.
-   Right-clicking any channel (admin or member) shows a notification sub-menu with check-mark on current level; muted channels display 🔕 in the sidebar.
-   `useServerWS` and `useUnreadDMs` skip sound/unread notifications when `channelLevel(id) === 'mute'`.

### ~~9.2. Browser / Desktop Push Notifications~~ ✅ Implemented
-   When the browser tab is in the background or minimised, qualifying messages (per the user's per-channel settings) trigger a native browser `Notification` via the [Web Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API).
-   **Permission flow**: On first notification-worthy event after login, the app requests `Notification.requestPermission()`. If denied, a dismissible banner explains how to re-enable it in the browser.
-   Notification content: sender avatar (via `icon`), sender display name + channel/server context as title, truncated message body.
-   Clicking the notification focuses the tab and navigates to the relevant channel.
-   Controlled by a toggle in **Settings → Notifications**: "Enable desktop notifications".
-   No notification is shown if the tab is already focused and the user is in the relevant channel.
-   Respects DND: notifications suppressed when user status is `dnd`.
-   Implemented via `useDesktopNotifications` hook + `DesktopNotificationsContext`; `notify()` called from `useUnreadDMs` alongside `playSound`.

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

### ~~10.2. PWA — Installability & Offline Shell~~ ✅ Implemented

Make the client installable as a desktop/mobile app with a cached static shell and a graceful offline page. API and WebSocket traffic remains network-only — no data caching at this stage.

**Implementation plan:**

1. **Install `vite-plugin-pwa`** (`npm i -D vite-plugin-pwa`) and add `VitePWA()` to `vite.config.ts` with `registerType: 'prompt'` so updates are user-triggered rather than silent.

2. **Web App Manifest** (auto-injected into `index.html` by the plugin):
   - `name`: "Chat", `short_name`: "Chat"
   - `display`: `standalone` (no browser chrome when installed)
   - `theme_color` / `background_color`: match the discord-dark palette (`#313338` / `#1e1f22`)
   - `start_url`: `/`
   - `scope`: `/`
   - Icon set: 192×192, 512×512 PNG (maskable variants for Android adaptive icons), 180×180 `apple-touch-icon`

3. **App icons** — generate a simple SVG speech-bubble logo, then use `sharp` or an online tool to export the required PNG sizes. Place in `public/pwa-*.png`.

4. **Workbox service worker** — `generateSW` strategy (simpler than `injectManifest`):
   - **Precache**: all Vite build output (JS/CSS chunks, HTML shell, fonts)
   - **Runtime cache**: `public/icons/**`, `public/sounds/**` (cache-first, long TTL)
   - **Network-only routes**: `/api/**`, `/ws/**`, `/static/**` (avatars, attachments) — never serve stale API responses
   - **Offline fallback**: if a navigation request fails (no network), serve the cached `index.html` shell; the app's existing `useServerWS`/reconnect logic will show its own "reconnecting…" state

5. **SW update toast** — `useRegisterSW` hook from `vite-plugin-pwa/react`:
   - When `needRefresh` is true, show a small toast at the bottom of the screen: "A new version is available." with a **Reload** button and a **Dismiss** button
   - `ReloadPrompt` component added to `App.tsx`

6. **`index.html` meta tags**:
   - `<meta name="theme-color" content="#1e1f22">`
   - `<meta name="apple-mobile-web-app-capable" content="yes">`
   - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
   - `<link rel="apple-touch-icon" href="/pwa-180.png">`

7. **Dev mode**: `devOptions: { enabled: true }` in the plugin config so the SW registers during `vite dev` (using the `mkcert` HTTPS that's already in place).

**Files touched:** `vite.config.ts`, `index.html`, `src/App.tsx`, new `src/components/ReloadPrompt.tsx`, `public/pwa-192.png`, `public/pwa-512.png`, `public/pwa-180.png`, `public/site.webmanifest` (auto-generated).

---

### ~~10.3. DM Offline Cache (Hybrid)~~ ✅ Implemented
- DM conversation history is persisted to IndexedDB so users can read recent messages and queue outgoing messages while offline. Server channels remain network-only.
- **Schema** (`src/db/dmCache.ts`): Dexie v4 database `chatter-dm-cache` with three tables: `dmMessages` (`[channel_id+id]` compound PK, secondary index on `channel_id, created_at`), `dmConversations` (`channel_id` PK), `dmOutbox` (`localId` PK, indexed by `channelId`). Messages are capped at 200 per conversation (oldest pruned on write).
- **Write-through** (`useChannelWS`): accepts `{ isDM?: boolean; onReconnect?: () => void }` options. When `isDM=true`, `message.created` and `message.updated` events call `cachePutMessage`; `message.deleted` calls `deleteCachedMessage`. The `onReconnect` callback is passed as `onOpen` to the WebSocket. Called from `DMPane` with `isDM=!isSelf`.
- **Online mirroring** (`MessageList`): when `partnerId` is set (DM mode), fetched pages are mirrored to IndexedDB via `cachePutMessages` as they load, tracked by a page-count ref to avoid redundant writes.
- **Offline read** (`DMPane`): listens to `window online/offline` events. When offline, replaces `MessageList` with a simple read-only view loading `getCachedMessages(channelId)`. Shows an orange "You're offline" banner with the cached message count.
- **Offline compose** (`MessageInput`): accepts `isOffline?: boolean` and `onOfflineSubmit?: (content) => void` props. When offline, shows an amber banner and routes sends to `onOfflineSubmit` instead of the API. `DMPane` provides `handleOfflineSubmit` which writes to `dmOutbox` and appends a greyed "queued" bubble to the display.
- **Outbox flush + gap sync on reconnect** (`DMPane.handleReconnect` via `useChannelWS.onReconnect`): on WS (re)open, flushes all outbox entries in creation order (`sendMessage` → `outboxRemove`), then fetches messages after `getLastCachedMessageId` using the new `GET /channels/{id}/messages?after=<id>` cursor, merges them into both the IndexedDB cache and the TanStack Query infinite cache.
- **`after` cursor** (`backend/app/routers/messages.py`, `frontend/src/api/messages.ts`): new `after` query parameter on `GET /channels/{id}/messages` returns messages with `created_at > after_msg.created_at`, used exclusively for gap-sync.
- **Conversation list offline** (`DMSidebar`): mirrors fetched conversations to IndexedDB via `cacheConversations`; on `offline`, loads `getCachedConversations()` and disables the network query.
- **Settings** (`SettingsPage` → Privacy & Safety → DM Cache): "Clear DM cache" button calls `clearDMCache()` (wipes messages, conversations, and outbox) with a 3-second "Cache cleared." confirmation.

## 11. UX Polish

### ~~11.1. Mark as Read Context Menus~~ ✅ Implemented
- Right-clicking a **server icon** shows "Mark as Read" when the server has unread channels; calls `markAllServerRead` to clear the server dot and all channel dots.
- Right-clicking the **DM nav button** in the server sidebar shows "Mark all as Read"; writes all conversation `lastRead` timestamps to `localStorage` and dispatches a synthetic `StorageEvent` so `useUnreadDMs` picks up the change in the same tab.
- Right-clicking any **text channel** in `ChannelSidebar` shows "Mark as Read" when that channel has an unread dot; calls `markRead(channelId)`.
- Right-clicking a **DM conversation row** in `DMSidebar` shows "Mark as Read"; saves `lastRead` for that conversation and dispatches the synthetic event.
- Fixed DM dot not clearing in the same tab: `storage` events only fire cross-tab, so same-tab writes now dispatch `window.dispatchEvent(new StorageEvent('storage', { key: LAST_READ_KEY }))`.
- Fixed server dot logic: `markRead(channelId)` auto-cascades and clears the server dot when the last unread channel in a server is read. `markServerRead` only clears the dot itself; `markAllServerRead` clears dot + all channel dots.

### ~~11.2. Server Icon Three-State Animation~~ ✅ Implemented
- Server icons have three distinct visual states driven by React-controlled hover + press state:
  - **Rest**: 48 px circle.
  - **Hover**: 64 px pill (fully rounded capsule — slightly wider than the circle).
  - **Active** (current server): 100 % full-width rectangle (8 px radius), persists while on that server.
- On **mousedown** the container scales to 0.90 (80 ms fast in, 200 ms ease-out release) giving a physical "click in place" press feel.
- `overflow-hidden` on the shape container clips images cleanly at all intermediate states.
- Active state is driven by `activeServerId` prop passed from `AppShell` (via `useMatch`) rather than `useParams`, which has no `:serverId` segment at the `ServerSidebar` render level.
- `useMatch('/channels/:serverId')` fallback added so servers navigated to without a remembered last channel (bare `/channels/:id` URL) are also detected as active.


## 12. Technical Debt & Bug Fixes (Audit Findings)

### 12.1. Performance

- **No list virtualisation in `MessageList`** — All loaded messages stay as live DOM nodes. As more pages load the list grows indefinitely. Needs `@tanstack/virtual` or `react-window`.
- **`MessageBubble` not memoized** — Every new WS message replaces `pages[0]`, triggering a re-render of every bubble in the list. Wrap with `React.memo` and stabilise callbacks with `useCallback`.
- **Hover state tracked in React state in `MessageBubble`** — `useState(false)` + `onMouseEnter/Leave` causes a re-render per mouse event. Replace with pure CSS `group`/`group-hover` Tailwind classes.
- **`bubbleRefs` Map grows unboundedly** — `bubbleRefs.current` in `MessageList` accumulates entries for all loaded messages and is never pruned. Add cleanup on unmount / page eviction.
- **Redundant polling on DM conversations** — `DMSidebar` and `useUnreadDMs` both set `refetchInterval: 60_000`. The WS `message.created` handler already keeps the list current; polling should be removed.
- **Voice presence polls every 10 s** — `ChannelSidebar` has `refetchInterval: 10_000` on `['voicePresence']`. The WS already handles `voice.user_joined/left` in real time; remove the interval.
- **`_slowmode_last` dict never pruned** — In-memory `Dict[str, Dict[str, float]]` in `messages.py` grows forever. Add periodic eviction of entries older than the channel's slowmode window.
- **In-memory rate limiter breaks under multiple workers** — `_windows` and `_slowmode_last` are per-process. With `uvicorn --workers N` each worker grants users `N×` the nominal limit. Move to Redis or a shared store.

### 12.2. UX / Accessibility

- **Status icon cutout mask drifts at non-100% zoom levels** — The CSS `radial-gradient` mask on `UserAvatar` calculates its hole center using `calc(100% - Npx)` / percentage-based coordinates while the `StatusIndicator` dot is positioned with `bottom`/`right` offsets. The layout engine and paint engine compute sub-pixel fractions slightly differently when the browser is zoomed, causing the cutout hole and the dot to drift apart. Fix: anchor both to the same **top-left origin** so both use identical math at every zoom level:
  - Mask center: `radial-gradient(circle at 70px 70px, transparent 11px, black 11.5px)` (absolute px from top-left).
  - Dot position: `top: 62px; left: 62px` (center 70px − half of 16px icon = 62px from top-left).
  - Long-term / highest-fidelity option: replace the CSS mask entirely with an **inline SVG** using `<clipPath>` + `<circle>` — SVG is vector-based and completely immune to zoom/DPI rounding. This is the approach used by Discord and Reddit.
- **Accept/Decline buttons hidden with `opacity-0`** — In `FriendsPane` the Accept/Decline buttons on incoming requests are invisible until mouse hover. Touch and keyboard users can never reach them.
- **`UserPanel` click area is a non-focusable `div`** — The avatar+username area has `onClick` on a plain `div` with no `role`, `aria-label`, or `tabIndex`. Should be a `button`.
- **`MessageInput` has no `maxLength`** — The backend 2 000-char limit is not enforced at the input level. Users get a silent server error instead of proactive feedback. Add `maxLength` and a live counter.
- **Edit textarea in `MessageBubble` also has no `maxLength`** — Same issue for the inline edit field.
- **Typed text lost on send failure** — `setText('')` runs before `sendMut` resolves. If the server rejects the message the user's text is gone. Clear only in `onSuccess`.
- **"Friend request sent!" never auto-clears** — The success message in `FriendsPane` persists indefinitely. Should auto-dismiss after a few seconds or on input change.
- **Silent failure on channel/category creation** — `handleCreateChannel`/`handleCreateCategory` in `ChannelSidebar` have no try/catch and no error toast.
- **`FriendsPane` shows no error state when friends/requests fetch fails** — A network failure renders an empty list with no message.
- **MessagePane search conflates "no results" with "search failed"** — `catch { setSearchResults([]) }` makes an actual error look like an empty result set.
- **"Add friend" form state (input, error, success) persists when switching `FriendsPane` tabs** — Stale messages carry over when navigating between tabs.

### 12.3. Security

- **Critical: Channel WS has no membership/access check** — `/ws/channels/{channel_id}` in `ws.py` verifies the JWT but never checks that the user is a member of the owning server or a participant in the DM. Any authenticated user can subscribe to any channel's event stream. The server WS already does a `ServerMember` check — the same guard must be added to the channel WS.
- **No rate limiting on `/auth/register` or `/auth/login`** — Both endpoints are completely open to enumeration and brute force. Add rate limiting (`slowapi` or `rate_limiter.py`).
- **`UserRead` leaks `preferred_status` and `hide_status`** — `_mask_user_read` only overrides `status`; the underlying `preferred_status` and `hide_status` fields are still serialised. Use a separate limited schema for third-party user views.
- **No minimum password length at registration** — `change_password` enforces 8 chars; `/auth/register` does not. Add the same validator to `UserCreate`.
- **Word-filter "warn" error leaks the exact regex pattern** — The 400 detail includes the literal pattern, letting users craft messages that bypass it. Remove the pattern from the public error message.
- **No rate limiting on friend requests, reactions, or DM channel creation** — These endpoints are exploitable for spam/DoS.

### 12.4. Real-time Sync Gaps

- **`PATCH .../channels/{channel_id}` never broadcasts `channel.updated`** — Channel renames, description changes, and slowmode updates are invisible to connected clients. The `channel.updated` handler already exists in `useServerWS`; the backend just needs to call `broadcast_server`.
- **`PATCH /servers/{server_id}` never broadcasts** — Server name/description changes require a page reload for other members. Add a `server.updated` broadcast.
- **`POST/PATCH .../categories` have no broadcast** — New and renamed categories are invisible to other connected members in real time.
- **Server image/banner uploads emit no WS event** — Other members see stale icons/banners until refresh.
- **Status change not sent to the user's own other tabs** — `broadcast_presence` sends `user.status_changed` to servers and friends via `/ws/me` rooms but not to the changing user's own room. A second tab never sees the change.

### 12.5. Error Handling

- **`reactMut`, `editMut`, `deleteMut`, `pinMut` in `MessageBubble` all lack `onError`** — Reaction, edit, delete, and pin failures are completely silent to the user.
- **`UserPanel` status-change handler has no try/catch** — An awaited `updateMe` or `refreshUser` failure results in an unhandled promise rejection.
- **`ChannelSidebar` create handlers silently throw** — Covered in UX above; any error goes unobserved.

### 12.6. Feature Gaps

- **DM unread state is device-local only** — `dmLastRead` in `localStorage` is not synced across devices or tabs. Reading on one device does not clear the badge on another. Needs server-side read receipts or a cross-device sync mechanism.
- **No `user.updated` WS event for username/avatar changes** — When a user changes their username or avatar, friend lists, server member lists, and DM sidebar entries go stale. A `user.updated` event needs to be broadcast and handled.
- **`channel.updated` client handler is dead code** — Fully implemented in `useServerWS` but never triggered because the backend never emits the event (see §12.4).
