# Structural Audit — Data Model & API vs Discord Standard

Findings from a deep read of backend ORM models, Pydantic schemas, and frontend TypeScript types.
Items are ordered roughly by impact. Each entry notes **all layers** that need changing.

---

## Critical

### A1. `Message.content` is NOT NULL — attachment-only messages are impossible
- **Backend model** `models/message.py` — `content: Mapped[str]` (non-optional)
- **Backend schema** `app/schemas/message.py` — `MessageCreate.content` is a required field
- **Impact**: sending an image/file with no caption text fails validation. Discord allows
  content-free messages that contain only attachments.
- **Fix**: make `content` nullable (empty string or `None`), add a cross-field validator that
  at least one of `content` / `files` must be non-empty.
- **Layers**: model → Alembic migration → schema → router → frontend `MessageCreate` payload

---

## Medium

### A2. `Attachment` is missing `filename`, `file_size`, `width`, `height`
- **Backend model** `models/message.py` — `Attachment` only has `file_path` and `file_type`
- **Impact**:
  - Original filename is lost; downloads are served with a UUID-based path name.
  - No image dimensions → browser can't reserve space → layout shift on load.
  - No file size → can't display the "8 MB" label Discord shows on non-image files.
- **Fix**: add columns `filename VARCHAR(255)`, `file_size BIGINT`, `width INT NULL`,
  `height INT NULL` to `Attachment`; populate on upload; expose in `AttachmentRead` schema
  and frontend `Attachment` type.
- **Layers**: model → migration → schema → router (populate on upload) → frontend type

### A3. `Reaction` table has no unique DB constraint
- **Backend model** `models/message.py` — no `UniqueConstraint("message_id", "user_id", "emoji")`
- **Impact**: a user can react with the same emoji multiple times at the DB level. The router
  may guard against it, but the DB doesn't enforce it.
- **Fix**: add `UniqueConstraint("message_id", "user_id", "emoji")` and a migration.
- **Layers**: model → migration

### A4. `Role` missing `hoist` and `mentionable` flags
- **Backend model** `models/server.py` — no `hoist` / `mentionable` columns
- **Backend schema** `app/schemas/server.py` — `RoleRead` doesn't expose them
- **Frontend type** `src/api/types.ts` — `Role` interface is missing both fields
- **Impact**: "hoist" (show role members in a separate section of the member list) is a core
  Discord role feature. `mentionable` controls whether `@RoleName` pings work.
- **Layers**: model → migration → schema → frontend type → MemberList rendering

### A5. `ServerMember` missing `nickname`
- **Backend model** `models/server.py` — `ServerMember` has no `nickname` column
- **Backend schema** `app/schemas/server.py` — `MemberRead` doesn't expose a nickname
- **Frontend type** `src/api/types.ts` — `Member` interface has no `nickname`
- **Impact**: per-server display names (a fundamental Discord feature) are not possible.
- **Layers**: model → migration → schema → frontend type → message rendering (show nick instead
  of username when present)

### A6. `ChannelPermission` uses 3 booleans instead of a granular permissions system
- **Backend model** `models/channel.py` — only `can_read`, `can_write`, `can_edit`
- **Impact**: too coarse to implement Discord-style fine-grained overrides (backlog 4.6):
  `can_attach_files`, `can_embed_links`, `can_mention_everyone`, `can_manage_messages`,
  `can_add_reactions`, `can_use_external_emojis`, `can_manage_roles`, etc.
- **Fix** (long-term architectural): replace the 3 booleans with an `allow_bits BIGINT` and
  `deny_bits BIGINT` permissions bitfield, matching Discord's overwrites structure.
- **Layers**: model → migration → schema → router permission checks → frontend settings UI

### A7. `UserStatus` enum uses `busy` instead of `dnd`
- **Backend model** `models/user.py` — `UserStatus.busy`
- **Frontend type** `src/api/types.ts` — `'busy'`
- **Impact**: inconsistent with Discord (`dnd` = Do Not Disturb). The backlog 9.3 DND
  integration spec already references `status === 'dnd'`. Status dot renders correctly
  (red) but the label is wrong everywhere it's shown (settings picker, profile card, etc.).
- **Fix**: rename enum value `busy → dnd` across model, migration, schema, frontend type,
  all components that reference the string, and `useSoundManager` DND check.
- **Layers**: model → migration (RENAME ENUM VALUE or new migration) → schema → frontend
  type → `StatusIndicator` label map → settings status picker → `useSoundManager`

### A8. `preferred_status` not exposed in `UserRead`
- **Backend schema** `app/schemas/user.py` — `UserRead` only returns `status`, not
  `preferred_status`
- **Impact**: the frontend can't restore the user's chosen status after a reconnect without
  a separate `/me` endpoint hit. On reconnect the server restores the status from
  `preferred_status` automatically, but the client never receives the initial value.
- **Fix**: add `preferred_status: UserStatus` to `UserRead`.
- **Layers**: schema only

### A9. `Channel` model missing `nsfw`, voice `user_limit`, and `bitrate`
- **Backend model** `models/channel.py` — no `nsfw`, `user_limit`, `bitrate` columns
- **Frontend type** `src/api/types.ts` — `Channel` interface missing all three
- **Impact**: voice channels can't have a user cap; no NSFW age-gate for channels.
- **Fix**: add optional columns; include in schema and frontend type.
- **Layers**: model → migration → schema → frontend type → channel edit modal

---

## Low / Cleanup

### A10. Stale `DM` interface in `types.ts`
- **Frontend type** `src/api/types.ts` — `interface DM` with `sender/recipient` fields is
  orphaned. The app migrated to channel-based DMs (`DMConversation` / `DMChannel`);
  this old interface is never used.
- **Fix**: delete `interface DM`.
- **Layers**: frontend type only

### A11. Legacy `direct_messages` table / model still exists
- **Backend model** `models/dm.py` — `DirectMessage` and `DMAttachment` models for the old
  sender/recipient DM system are still present.
- The app now uses `dm_channels` + regular `channels` (type=dm). The old table is dead code.
- **Fix**: drop `models/dm.py`, remove the `User.sent_dms` / `User.received_dms`
  back-references from `models/user.py`, add a "drop table" Alembic migration to clean up
  the DB.
- **Layers**: model → migration → user model back-refs

### A12. `ChannelType.dm` missing from frontend `ChannelType`
- **Frontend type** `src/api/types.ts` — `type ChannelType = 'text' | 'voice'` is missing
  `'dm'`
- The backend `ChannelType` enum has `dm`; any frontend code that checks channel type
  against this union will silently miss DM channels.
- **Fix**: add `| 'dm'` to the union type.
- **Layers**: frontend type only

---

## Already Correct (noted for completeness)
- Refresh token rotation — implemented ✅
- Message 2 000-character limit — enforced in schema ✅
- HTML sanitisation on all text inputs — `strip_html` applied in validators ✅
- Cursor-based message pagination (`before` query param) ✅
- Per-message rate limiting (`rate_limit_messages` dependency) ✅
- `DMChannel` unique constraint on `(user_a_id, user_b_id)` — DB-level `UniqueConstraint` ✅
- Magic-byte file validation on uploads ✅
