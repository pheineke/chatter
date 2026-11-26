# TODO — Code, Structure, Layout & UX Review

_Review date: 2026-11-25 (commit `3ce4e8a`). Complements, and does not repeat, `docs/backlog.md`, `docs/structural_audit.md` and `docs/structural_audit_frontend.md`._
_Security findings are in **[docs/security_pass.md](docs/security_pass.md)**. Its 🔴 items block going public and come before everything here._

Legend: 🔴 do first · 🟠 high value · 🟡 worthwhile · 🟢 polish · (S#) = linked security item

---

## 0. Blockers (from the security pass)
- [x] 🔴 S1: lock down `/meta` link-preview proxy (auth + SSRF guard)
- [x] 🔴 S2: fix `/interactions` impersonation (ownership + channel access)
- [x] 🔴 S3: actually enforce channel permission bits (`VIEW_CHANNEL`, `SEND_MESSAGES`, …) Done, including an implicit `@everyone` role (`Role.is_default`) and a "Private channel" toggle in channel settings.
- [x] 🔴 S4: remove/gate `POST /servers/{id}/join`
- [x] S5, S6, S9, S10, S13, S14: proxy IPs for rate limiting, token TTL, edit path, reply leak, voice presence, usernames
- [x] S11: open WebSockets follow revocation, kicks/bans and permission changes
- [x] S8: upload size caps, rate limit, per-message cap, quota, disk floor, decompression bombs
- [x] 🟠 S7: refresh race (see security_pass.md)
- [x] 🟠 S12: TLS (`docker-compose.prod.yml` + Caddy, see docs/deploying.md)
- [ ] Client-side size check for avatar/banner/server image/emoji/font uploads too (only the message composer has it).
- [ ] Delete attachment files when their message is deleted (they count against the quota and stay reachable by URL).

---

## 1. Backend architecture

### 1.1 Introduce a service layer and authorization module 🟠
Routers mix HTTP, authorization, DB queries and WS fan-out. For example, `messages.py` (722 lines) and `servers.py` (836 lines) each define their own `_require_*` helpers, and other routers import private helpers across modules (`from app.routers.servers import _require_member, _require_admin`; `mls.py` imports from `messages.py`).
- [~] `app/authz.py` now exists (channel permissions, done for S3). Still to do: move `require_member`/`require_admin` there and stop importing private helpers across routers.
- [ ] Create `app/services/messages.py`, holding the message pipeline (access → perms → slowmode → filters → persist → mentions → broadcast). The REST send, edit, interactions and any future bot path then all share one code path. This structurally fixes S2 and S9.
- [ ] Make routers thin: parse → call service → return.

### 1.2 Fire-and-forget tasks are unsafe 🟠
`asyncio.create_task(_notify())` in `messages.py` keeps no reference, so the task can be garbage-collected mid-flight and exceptions vanish silently.
- [ ] Add a small `background.spawn(coro)` helper that keeps a set of tasks, logs exceptions and drains on shutdown (FastAPI lifespan).

### 1.3 Single-process state blocks scaling and restarts 🟡
`ws_manager`, `voice_manager` and `presence` are in-memory dicts. Redis is already supported for rate limits.
- [ ] Put WS fan-out behind Redis pub/sub when `RATELIMIT_REDIS_URL` is set, then rename the setting `REDIS_URL`.
- [ ] Document "single uvicorn worker only" until then. The Dockerfile already uses one worker; keep it that way on purpose.

### 1.4 Database & queries 🟡
- [ ] Add a composite index `messages(channel_id, created_at DESC)`. Every history page sorts on it.
- [ ] Message search uses `ILIKE '%q%'`, which scans the whole table and doesn't escape `%` or `_`. Use Postgres `tsvector` + GIN (or `pg_trgm`) and escape LIKE wildcards. Note that E2EE content can't be searched server-side, so say so in the UI.
- [ ] `before`/`after` cursors run an extra query each. Use `(created_at, id)` keyset pagination with a tiebreaker. Messages with the same timestamp are currently skipped or duplicated.
- [ ] Add a periodic cleanup job: revoked/expired refresh tokens, used/expired QR sessions, consumed MLS key packages, orphaned attachment files when a message is deleted (deletion currently only sets `is_deleted` and `content="[deleted]"`, so files stay on disk and are still publicly reachable).
- [ ] Squash migrations. There are about 40, with mixed naming (`add_x.py` vs hash-prefixed) and a hand-written merge. A clean baseline before going public makes fresh installs reliable.

### 1.5 Testing & CI 🟠
- [x] WebSocket tests used to need a live Postgres on :5432: WS auth/routers open sessions via `AsyncSessionLocal`, bypassing the `get_db` override. `conftest.install_session_factory` now routes every session to the test DB, and the TestClient fixtures use a file-backed SQLite (one connection per session) so WebSocket threads don't share a single in-memory connection.
- [x] `TEST_DATABASE_URL` runs the whole suite on Postgres; CI does this with a `postgres:15-alpine` service, applies all migrations from scratch and round-trips the latest two.
- [x] CI frontend job now runs `npm run build` (includes `tsc`).
- [x] `pytest-timeout` (120 s default) so a WebSocket left open fails instead of hanging the run.
- [ ] **Lint debt**: `ruff check .` reports ~225 findings (import order, PEP 604 hints, 52 F821 from SQLAlchemy string forward refs → add `TYPE_CHECKING` imports). CI blocks only on E9/F63/F7 until this is cleaned up, then make full `ruff check` blocking again.
- [ ] Old migration `f7a8b9c0d1e2` can't be downgraded on Postgres (writes integers into boolean columns). Fix or document migrations as forward-only, then squash (see 1.4).
- [x] Add `pip-audit` / `npm audit` (S29). Still to do: `ruff format --check`.
- [ ] Upgrade react-router-dom 6 → 7. It clears a moderate advisory (open redirect via backslash in `<Link>`/`useNavigate`). Exposure is low: our navigate targets come from in-app state, not the URL.
- [ ] Postgres runs are ~4× slower (tables created/dropped per test); switch to one schema per session + per-test transaction rollback if CI time becomes a problem.

### 1.6 Small backend cleanups 🟢
- [ ] Delete `app/utils/rate_limiter.py` (a stub that only raises) and `scripts/debug_query.py` if it's unused.
- [ ] `main.py` does a `sys.path.insert`. Package the backend properly (`pyproject` + `app` as a package, with `models` inside it) instead.
- [ ] Add structured logging (request ID, user ID) instead of `print`. There's no logging config today.
- [ ] Add a `lifespan` handler: DB engine dispose, Redis close, background-task drain.
- [ ] `/health` should check DB connectivity (`SELECT 1`), not just return ok.
- [ ] `Readme.md` says "128 tests" and "python-jose / passlib", but passlib is no longer used. Refresh the README, and add an architecture diagram plus a "Deploying publicly" section.
- [ ] Remove the stray `frontend/Select-Object` file (a UTF-16 PowerShell error dump that was committed by accident).

---

## 2. Frontend architecture

### 2.1 Split the god components 🟠
| File | Lines | Suggested split |
|---|---|---|
| `pages/SettingsPage.tsx` | 1534 (41 `useState`) | One file per tab: `settings/AccountTab`, `ProfileTab`, `AppearanceTab`, `VoiceTab`, `SessionsTab`, `TokensTab`, … plus a `useLocalSetting(key, default)` hook to replace the ~20 hand-rolled `localStorage` reads/writes. |
| `components/ChannelSidebar.tsx` | 1147 | `ChannelList`, `CategoryRow`, `ChannelRow`, `CreateChannelModal`, `useChannelDnd` (already noted in the frontend audit as B2, and has grown since). |
| `pages/ServerSettingsPage.tsx` | 1107 | Tabs → files (Overview, Roles, Members, Emojis, Filters, Bans, Invites, Audit). |
| `components/VoiceGridPane.tsx` | 1010 | `VoiceTile`, `ScreenSharePopout` (the `innerHTML=''` pop-out window logic), `useVoiceLayout`. |
| `components/MessageBubble.tsx` | 810 | `MessageHeader`, `MessageBody`, `AttachmentList`, `ReactionBar`, `MessageActions`. It's already `memo`'d. Check that callback props (`onReply`, `onScrollToMessage`) are stable, or the memo does nothing. |
| `components/MessageInput.tsx` | 715 | `useComposer` (draft/reply/edit state), `AttachmentTray`, `SlashCommandMenu`, `MentionAutocomplete`. |

### 2.2 One auth/token module 🟠
Token refresh was implemented twice (`api/client.ts` and `hooks/useWebSocket.ts`), the root cause of S7.
- [x] ~~Create `auth/tokenStore.ts`~~ Done as `api/refresh.ts` (`refreshAccessToken`, `forceLogout`). Still open: a `storage` listener so a logout in one tab logs out the others.
- [ ] Replace `window.location.href = '/login'` with a router navigation plus a "session expired" toast, so in-progress drafts aren't lost.

### 2.3 One WebSocket connection instead of N 🟡
Each open channel, server and `/ws/me` opens its own socket and runs its own auth handshake. A single multiplexed `/ws` gateway with `subscribe`/`unsubscribe` frames (like `/ws/bot` already does) means fewer connections on the Pi, one reconnect/backoff path, one heartbeat, and simpler gap-sync on reconnect.

### 2.4 Performance 🟡
- [ ] **Route-level code splitting**: `App.tsx` imports every page eagerly. Use `React.lazy` for Settings, ServerSettings, ChannelSettings, QRLogin and voice, and lazy-load `ts-mls`, `emoji-mart` and `jsqr`. These are heavy and not needed for first paint.
- [ ] **Virtualise the message list** (`@tanstack/react-virtual`). `MessageList` only uses an IntersectionObserver for load-more, so the DOM grows without bound in busy channels.
- [ ] Use TanStack Query normalisation for WS updates (`setQueryData` per message) instead of invalidating whole lists.

### 2.5 Consistency 🟢
- [ ] Add a `src/constants/` module for limits (2000-char message, 120-char status, upload size, slowmode steps), ideally served by a `GET /config` endpoint so the frontend and backend can't drift.
- [ ] Generate `api/types.ts` (298 hand-written lines) from FastAPI's OpenAPI with `openapi-typescript`, so schema drift shows up as a compile error.
- [ ] Add one `useToast()` / error-boundary pattern. Several mutations still handle errors ad hoc.

---

## 3. Layout & UX

### 3.1 Onboarding & empty states 🟠
- [ ] First-run experience: after registering, the user lands on an empty `@me` with no guidance. Add an empty state with "Create a server", "Join with invite link" and "Add a friend" actions.
- [ ] Prompt for an E2EE key backup at a natural moment (first DM) instead of as an interruption, and explain in plain words what is lost without it.
- [ ] Empty channel: a "This is the beginning of #channel" header with the description and a quick "invite people" button.

### 3.2 Trust & safety UX (needed once public) 🟠
- [ ] Report message/user flow, plus a basic admin moderation queue.
- [ ] Message deletion by moderators should show "deleted by a moderator" and be recorded in the audit log (deletes aren't audited today).
- [ ] Show a visible **lock icon / "encrypted" state** per channel and DM, plus a **safety-number-changed** warning (see privacy notes in the security pass).
- [ ] QR-login approve screen: show the new device's browser/OS/IP and require an explicit confirmation (S18).
- [x] "Private channel" toggle in channel settings (denies `VIEW_CHANNEL` for `@everyone`, shows who can still see it).
- [x] When a channel becomes hidden for someone who has it open, they're navigated away (channel list refetch) and their channel/voice socket is closed.
- [ ] Close sockets when their JWT expires (today only on revoke), and when a server is deleted.
- [ ] Role order UI: drag to reorder roles in server settings (sends `position`). The backend enforces the hierarchy (S28), but today only the API can build an admin ladder. Also grey out roles and members the viewer can't manage, instead of letting them hit a 403.

### 3.3 Accessibility 🟡
Only **14** `aria-label`s across the app, and **19** clickable `<div>`/`<span>` elements.
- [ ] Convert clickable divs/spans to `<button>`, and add `aria-label` to every icon-only button (the mask-image `Icon` component renders no text).
- [ ] Give the message list `role="log"` with `aria-live="polite"` so screen readers announce new messages.
- [ ] Focus management: trap focus in `PortalModal`/`BottomSheet` and return it on close. Make the context menu keyboard-navigable (arrow keys, Esc).
- [ ] Respect `prefers-reduced-motion` for the animated avatar frames and transitions.
- [ ] Contrast-check the theme presets (`docs/themes/*`). Custom `colorOverrides` can produce unreadable combinations, so add a contrast warning in the colour picker.

### 3.4 Mobile 🟡
- [ ] Swipe gestures between the server list, channel list, chat and members (BottomSheet already exists).
- [ ] Composer: keep it above the keyboard (`visualViewport`), and give the attachment button a larger touch target.
- [ ] Long-press on a message should open the action sheet (hover-only actions don't work on touch).

### 3.5 Messaging quality-of-life 🟢
- [ ] Optimistic send with a "sending…/failed – retry" state (the typed-text-loss fix exists; this goes one step further).
- [ ] Drafts per channel, kept across channel switches.
- [ ] "Jump to present" bar and an unread divider line ("New messages") when you open a channel with unreads.
- [ ] Upload progress bars, plus client-side image compression before upload (this also helps S8).
- [ ] Edit history indicator ("edited" tooltip with time).

### 3.6 Settings layout 🟢
- [ ] One `SettingsLayout` shell for user, server and channel settings (frontend audit L1). Settings pages should also get deep-linkable tabs (`/settings/appearance`) so the browser Back button works.
- [ ] A search box in Settings once it's split into tabs.
- [ ] "Unsaved changes" bar (Discord-style) for all settings forms, not only Appearance.

---

## 4. Ops / deploy (to go public)
- [x] TLS reverse proxy (Caddy) in `docker-compose.prod.yml`, with HSTS (S12). Guide: `docs/deploying.md`.
- [x] `uvicorn --proxy-headers --forwarded-allow-ips` (S5).
- [x] Non-root, multi-stage backend image (S24); compose adds `read_only`, `cap_drop: [ALL]`, `no-new-privileges`.
- [ ] Add a `healthcheck:` for each service and `depends_on: condition: service_healthy` for the DB.
- [ ] Frontend: an unprivileged nginx image (`nginxinc/nginx-unprivileged`) and `cap_drop` there too.
- [x] Full-stack trial (2026-11-26, isolated `chattertrial` project): nginx → backend in production + invite mode, 20/20 smoke checks (headers, hidden docs, invites, refresh, WebSocket incl. frame cap, signed attachments) and the hardened container (uid 1000, read-only, no caps). Found and fixed `microphone=()` in nginx's Permissions-Policy, which blocked voice chat.
- [ ] Still untested as a running stack: the Caddy overlay with a real certificate (needs a domain and ports 80/443).
- [x] Backups: `scripts/backup.sh` (pg_dump + static/, 14-day rotation), restore documented in `docs/deploying.md`. Restore tested 2026-11-26: wiped DB volume and uploads, followed the documented steps; accounts, roles, messages and attachments came back.
- [ ] TURN server (coturn) for voice behind NAT and for IP privacy.
- [ ] Basic observability: access logs without tokens, error tracking (self-hosted GlitchTip/Sentry), disk-usage alert (uploads on a Pi SD card).
- [x] Registration switch: `REGISTRATION_MODE=open|invite|closed`.
- [ ] Optional CAPTCHA (hCaptcha/Turnstile), and email verification if email is ever added.
- [ ] A `SECURITY.md` with a vulnerability-reporting contact, plus Terms/Privacy pages.
