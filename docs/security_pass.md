# Cybersecurity Pass — "Can this go public?"

_Date: 2026-11-25 · Scope: `backend/`, `frontend/`, `docker-compose.yml`, `frontend/nginx.conf` at commit `3ce4e8a`._
_Method: manual code read of the auth, authorization, upload, WebSocket, link-preview, bot, E2EE/QR and deploy layers. No dynamic testing or dependency CVE scan was run._

## Verdict

**Not ready for public exposure.** The groundwork is good: rotating refresh tokens, session revocation, post-connect WS auth, magic-byte upload checks, DOMPurify, CSP, and a production-defaults guard. But there are **four critical authorization holes**. Each one can be exploited by any registered user with a few HTTP calls. Fix the 🔴 items, and ideally the 🟠 items, before the instance can be reached from the internet.

| Severity | Count | Meaning |
|---|---|---|
| 🔴 Critical | 4 | Account impersonation, private-data exposure, or internal-network access by any user |
| 🟠 High | 8 | Real abuse or DoS paths, or weaker-than-intended auth |
| 🟡 Medium | 10 | Defense-in-depth gaps, info leaks, hardening |
| 🟢 Low | 7 | Hygiene |

---

## 🔴 Critical

### S1. Unauthenticated SSRF in the link-preview proxy
> **✅ Fixed (2026-11-25).** Auth + 30/min rate limit; IP check in an httpcore network backend (every hop, rebinding-safe); ports 80/443 only; generic errors. Tests: `tests/test_critical_fixes.py`.
`backend/app/routers/meta.py:67`: `GET /api/meta?url=` has **no auth dependency**, **no private-IP or hostname blocking**, and `follow_redirects=True`. nginx exposes it publicly (`meta` is in the proxy regex).
- **Attack:** anyone on the internet can make the server fetch `http://192.168.x.x/…` (your Pi's LAN: router admin, NAS, Home Assistant), `http://backend:8000/…`, `http://169.254.169.254/` (cloud metadata), and so on. Page `<title>`/`og:*` content and error strings (`Failed to fetch URL: {exc}`) are returned, so this is a read oracle. It also works as a free open proxy and DoS amplifier.
- **Fix:** require `CurrentUser` and a per-user rate limit. Resolve DNS yourself and reject private, loopback, link-local, CGNAT, multicast and IPv6-ULA ranges. Re-validate **every redirect hop** (turn off `follow_redirects` and loop manually, max 3). Pin the connection to the resolved IP to defeat DNS rebinding. Allow only ports 80 and 443. Return generic error messages. Optionally proxy the `og:image` through the server too (see S16).

### S2. Bot "interactions" allow impersonating any user in any channel
> **✅ Fixed (2026-11-25).** Commands can only be registered by the bot account itself; only `is_bot` users can author interaction messages; invoker needs SEND_MESSAGES in the channel; word filters + message rate limit apply; command listing requires auth.
`backend/app/routers/interactions.py:30` and `:92`
- `POST /applications/{application_id}/commands` checks only that `application_id` is *some* user. There is **no ownership check** (the `is_bot` check is commented out).
- `POST /interactions` then writes a `Message` with `author_id = cmd.application_id` into `interaction.channel_id`. There is **no channel-access check**, no word filter, no rate limit, and the `echo` command takes attacker-supplied content.
- **Attack:** register `echo` under the victim's user ID, then call `/interactions` with any `channel_id`. The message appears **as the victim** in any server channel or DM, including ones the attacker can't access.
- **Fix:** only allow `application_id == current_user.id` (or a bot owned by the caller) and require `is_bot`. Call `_require_channel_access` (plus send-permission, see S3) on `interaction.channel_id` and check that `server_id` matches the channel. Apply the message rate limit and word filters. Until bots are real, consider disabling these routes entirely.

### S3. Channel permission overwrites are stored but never enforced
> **✅ Fixed (2026-11-25).** `app/authz.py` resolves permissions; enforced on history, send, edit, delete-others (MANAGE_MESSAGES), attachments, reactions, pins, channel list, channel WS, voice WS and MLS fan-out. Follow-up (same day): added the implicit `@everyone` role and a "Private channel" toggle, so channels can now be private to chosen roles. Also fixed two IDORs found on the way: overwrites could be written onto another server's channel, and `remove_role` didn't check the role's server.
`models/channel.py:10` defines `ChannelPerm.VIEW_CHANNEL / SEND_MESSAGES / MANAGE_MESSAGES / ATTACH_FILES …`, and `channels.py:332` lets admins set them. But **no code path ever reads `allow_bits`/`deny_bits`**. `_require_channel_access` (`messages.py:179`) and the channel WS (`ws.py:50`) only check server membership.
- **Impact:** every "private" or role-gated channel is fully readable (REST history, search, live WS), writable and uploadable by **every member** of the server. Users will believe channels are private when they are not.
- **Fix:** write one `compute_channel_permissions(user, channel)` (server owner → all; admin role → all; otherwise base perms → role allow/deny overwrites, with deny winning). Use it in list/send/edit/delete/pin/react/upload, channel WS subscribe, voice WS, MLS group endpoints, search, and the channel list (hide channels without VIEW). Add tests per bit.

### S4. Anyone can join any server by ID, bypassing invites
> **✅ Fixed (2026-11-25).** Endpoint removed; joining only via `/invites/{code}/join`.
`backend/app/routers/servers.py:328`: `POST /servers/{server_id}/join` needs only auth and a not-banned check. Server UUIDs are not secret: the invite preview (`GET /invites/{code}`) returns them, as do WS events and URLs (`/channels/{server_id}/…`).
- **Impact:** invite expiry, `max_uses` and revocation mean nothing, because a user who saw one invite (or one URL) can rejoin forever. Combined with S3, every server is effectively public.
- **Fix:** remove the endpoint, or restrict it to servers explicitly flagged `is_public`. Joining should only go through `/invites/{code}/join`.

---

## 🟠 High

### S5. Rate limiting keys on the nginx container IP, not the client
> **✅ Fixed (2026-11-25).** uvicorn runs with `--proxy-headers`; nginx *overwrites* `X-Forwarded-For` with `$remote_addr` (so clients can't spoof it) on `/api` and `/ws`; `/ws` also got 1 h read/send timeouts. Hard per-username lockout is still there; back-off/CAPTCHA remains a TODO.
`rate_limiter.py` (`rate_limit_auth`, `rate_limit_auth_login`) uses `request.client.host`. In docker-compose, uvicorn runs without `--proxy-headers --forwarded-allow-ips`, so every request appears to come from the nginx container.
- **Impact:** (a) the 30/min auth bucket is **global**, so one script locks *everyone* out of login and registration; (b) the per-username login limit becomes global, so anyone can lock a specific user out by sending 6 bad passwords a minute.
- **Fix:** run `uvicorn ... --proxy-headers --forwarded-allow-ips=<nginx network/IP>` and keep `X-Forwarded-For` set in nginx (it already is for `/api`, but **not** for `/ws`). For lockout, prefer exponential back-off plus CAPTCHA over a hard per-username block.

### S6. `backend/.env.example` ships `ACCESS_TOKEN_EXPIRE_MINUTES=10080` (7 days)
> **✅ Fixed (2026-11-25).** Example is 15; `ENVIRONMENT=production` refuses values above 60.
The code defaults to 15 minutes and is designed around short-lived access tokens. Anyone who copies the example gets **week-long bearer tokens**. Revocation still works over REST (session check), but long-lived WS sessions and any leaked token stay useful for a long time.
- **Fix:** set it to `15` in the example, and make the production guard reject values above about 60.

### S7. Refresh-token race logs users out of everything (and is a reliability bug)
> **✅ Fixed (2026-11-25).** Rotation is now a conditional `UPDATE … WHERE revoked = false` (plus `FOR UPDATE` on Postgres), so of concurrent refreshes exactly one wins. Refresh tokens record `rotated_at`; only a replay of a *rotated* token older than `REFRESH_REUSE_GRACE_SECONDS` (30) wipes the user's sessions. A token ended by logout or session revocation just gets a 401 (before, a revoked device refreshing logged the user out everywhere). The frontend has one refresh routine (`src/api/refresh.ts`) used by axios and WebSockets: single-flight per tab, a Web Lock across tabs, re-checks storage for another tab's tokens, and no logout on network errors.
`frontend/src/hooks/useWebSocket.ts:15` and `frontend/src/api/client.ts` each run their **own** refresh logic. Tabs share `localStorage`. Because tokens rotate and reuse is detected (`auth.py:104`, which deletes **all** user sessions), two concurrent refreshes of the same token trigger "reuse detected" and wipe every session. The server side has no `SELECT … FOR UPDATE`, so two parallel refreshes can also both succeed and mint two sessions.
- **Fix:** keep one refresh function shared by axios and WS, use a cross-tab lock (`navigator.locks.request('refresh', …)` or a `BroadcastChannel`), lock the row server-side (`with_for_update()`), and add a short grace window for the just-rotated token.

### S8. No upload size enforcement; whole files are read into RAM
> **✅ Fixed (2026-11-25).** Uploads are read in 64 KB chunks with a hard cap (413), and bodies over 9 MB are refused by `Content-Length` before parsing; nginx `client_max_body_size` is now 10M. Uploads are rate-limited (20/min/user), capped at 10 attachments per message, subject to a per-user quota (`USER_STORAGE_QUOTA_MB`, default 500) and paused when the static volume has under `MIN_FREE_DISK_MB` (1024) free. Images over 40 megapixels are rejected before decoding (decompression bombs). Fonts must have a real font signature. The client checks size before sending, so an oversized file no longer leaves an orphan text message.
`settings.max_upload_size` (8 MB) is **never referenced**. `verify_attachment_magic` / `verify_image_magic` call `await file.read()` with no cap. nginx allows 50 MB. `upload_attachment` (`messages.py:490`) has no rate limit and no per-message attachment cap.
- **Impact:** a handful of parallel 50 MB uploads can exhaust a Raspberry Pi's memory, and repeated uploads fill the disk.
- **Fix:** stream with a hard cap (read in chunks, abort above the limit), set nginx `client_max_body_size` to the real limit, rate-limit uploads, cap attachments per message (e.g. 10), and track a per-user storage quota.

### S9. Edit path skips the checks the send path does
> **✅ Fixed (2026-11-25).** Edits now need channel access + SEND_MESSAGES, run word filters and the message rate limit.
`messages.py:433` `edit_message`:
- **No word filter.** Post a clean message, then edit it to the banned text, and the filter is bypassed.
- **No channel-access re-check.** Kicked or banned users can still edit their old messages.
- **No rate limit.** Each edit also triggers a full re-broadcast.
- **Fix:** run the same pipeline as send: access, permissions (S3), filters, rate limit.

### S10. Reply preview leaks messages from other channels and DMs
> **✅ Fixed (2026-11-25).** `reply_to_id` must be a live message in the same channel.
`messages.py:363` stores `reply_to_id` without checking that the target message is in the **same channel**. `MessageRead.reply_to` returns the target's `content` and author. If you know a message UUID (from a shared screenshot, a URL, a former membership, or a WS log), you can read it from any channel, including DMs.
- **Fix:** reject a `reply_to_id` whose `channel_id` doesn't match, or null the preview when the viewer can't access it.

### S11. Revocation/kick doesn't apply to open WebSockets
> **✅ Fixed (2026-11-25).** Sockets carry their owner (user, session, API token) from the auth handshake. `app/ws_enforcement.py` closes them with 4001 on session/token revoke, logout and refresh-token reuse, and with 4003 on kick/ban/leave and whenever permissions change (overwrites, role assign/remove/update/delete) for anyone who lost View Channel, voice included. The bot gateway is unsubscribed from the server instead of closed. Unread badges for a private channel now only go to its viewers. Frontend stops reconnecting on 4003/4004 and ends a voice call that was revoked. **Not covered:** a long-lived socket isn't closed when its access token *expires* (only when revoked); and deleting a server doesn't close sockets for its channels.
WS auth happens once at connect (`ws_auth.py`). After a session is revoked, a password change, a kick or a ban, existing `/ws/channels`, `/ws/servers`, `/ws/voice` and `/ws/bot` connections **keep receiving events**. The bot gateway snapshots server membership at connect.
- **Fix:** on revoke, kick or ban, call `manager.disconnect_user(user_id, server_id=…)` and close the affected sockets. Also re-validate the session every N minutes inside long-lived loops, or close sockets when the JWT `exp` passes.

### S12. No TLS in the shipped deployment
> **✅ Fixed (2026-11-25).** `docker-compose.prod.yml` puts Caddy in front (automatic Let's Encrypt, HSTS `max-age=31536000`), stops publishing nginx's plain-HTTP port, and passes the real client IP and `X-Forwarded-Proto` through. Guide: `docs/deploying.md`. Not done: refusing to start in production without HTTPS (the backend can't tell reliably at boot).
`docker-compose.yml` exposes plain HTTP on `:9090`. There's no HSTS and no `wss://`. Passwords, bearer tokens, refresh tokens and the QR-login key exchange all travel in cleartext unless something else terminates TLS.
- **Fix:** document and ship a TLS front (Caddy or Traefik with Let's Encrypt, or Cloudflare Tunnel). Add `Strict-Transport-Security`. Refuse `ENVIRONMENT=production` if `X-Forwarded-Proto` isn't https.

---

## 🟡 Medium

| # | Finding | Where | Fix |
|---|---|---|---|
| S13 ✅ | **(Fixed: auth + membership + View Channel.)** **Unauthenticated voice presence**: `GET /channels/{id}/voice/members` and `GET /servers/{id}/voice-presence` have no auth and are proxied publicly, so anyone can see who is in voice in any server. | `voice.py:89`, `:99` | Add `CurrentUser` + `_require_member`. |
| S14 ✅ | **(Fixed: `[A-Za-z0-9_]{2,32}` after NFKC, unique on `lower(username)`, case-insensitive login/mentions; separate `display_name` still TODO.)** **Case-sensitive username uniqueness**: register checks `username ==`, but `/users/search` uses `lower() ==` with `scalar_one_or_none()`. `Alice` and `alice` can both register, which enables impersonation and makes search **500** (`MultipleResultsFound`). No charset rules, so homoglyphs and zero-width characters are allowed. | `auth.py:58`, `users.py:178` | Unique index on `lower(username)`, NFKC-normalise, restrict to `[A-Za-z0-9_.-]{2,32}`, separate `display_name`. |
| S15 | **Tokens in `localStorage`**: any XSS = full account takeover, including the refresh token and (via IndexedDB) E2EE keys. | `client.ts`, `useWebSocket.ts` | Move the refresh token to an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/auth/refresh` and keep the access token in memory only. |
| S16 | **Third-party images leak user IPs**: markdown allows `<img src=any>`, link embeds load `og:image` directly, and CSP `img-src https:` permits any host. Posting an image link logs the IP of everyone who views the channel. | `utils/markdown.ts:92`, nginx CSP | Proxy and cache remote images through the backend (with S1's protections), or click-to-load. Then narrow `img-src`. |
| S17 | **`banner` is a free-form string** put into `style={{backgroundImage: url(/api/static/${banner})}}`. A value with `)` can inject extra CSS `url()`s (tracking) or path-traverse (`../`). `theme_colors` and `theme_preset` are also unbounded strings. | `users.py` `update_me`, `ProfileCard.tsx:135` | Never accept `banner` via PATCH (only via upload). Validate `theme_colors` as JSON of `#hex` with a size cap. |
| S18 | **QR-login stores live tokens in plaintext in the DB** and never clears them after `used`. `/auth/qr/challenge` is unauthenticated and not rate-limited (DB spam). The approve flow is open to classic **QRLjacking**: an attacker shows a victim their QR, the victim approves, and the attacker gets the session *and the E2EE private key*. | `e2ee.py:110–222` | Null the token fields once delivered, purge expired rows, rate-limit challenges. On approve, show the new device's UA/IP/location and a "did you just scan this on your own device?" confirmation. Consider a short code the user must match on both screens. |
| S19 | **Personal API tokens = full account power**, with no scopes, no expiry and no IP binding. A leaked bot token can do everything except change the password (that needs the current one): read all DMs, delete servers, create more tokens. | `dependencies.py`, `tokens.py` | Add scopes (read, send, manage), optional expiry, and per-token rate limits. Block account-management routes for `Bot` auth. |
| S20 | **Login timing reveals which usernames exist** (bcrypt runs only when the user exists), and `/register` says "Username already taken". | `auth.py:78` | Verify against a dummy hash when the user is missing. Registration enumeration is inherent, so rely on rate limiting. |
| S21 | **Password policy**: minimum 8 characters, no maximum. bcrypt 5.x **raises on >72 bytes**, so a long password probably **500s** registration or login (verify). `change-password` doesn't revoke other sessions. | `schemas/user.py`, `users.py:210` | Cap at 72 bytes (or pre-hash with SHA-256 + base64), check against a breached-password list (k-anon HIBP), and revoke other sessions on change. |
| S22 ✅ | **(Fixed: the stored extension comes from the verified content type; the filename is display-only and trimmed to 255 chars. Attachments are only served with a signed URL (`exp` + HMAC, valid 24–48 h) that the API includes as `attachment.url`; bare or forged paths get 403, including `//` and `..` variants. A link still works for whoever holds it until it expires, and isn't revoked when someone loses access. A separate origin for user files would be the next step.)** **Attachment extension comes from the user's filename** (`file.html`, `x.svg` …). It's mitigated by forced `Content-Disposition: attachment`, but the stored extension then drives `StaticFiles` content-type guessing, and attachments are served **unauthenticated** to anyone with the URL (including attachments from E2EE DMs, which are only as private as the URL). | `messages.py:530`, `main.py:35` | Derive the extension from the detected MIME, and add `X-Content-Type-Options: nosniff` on the backend too. Longer term, serve attachments through an authenticated route or signed short-lived URLs, ideally from a separate origin. |

---

## 🟢 Low / hygiene

- **S23** ✅ *Fixed:* the backend sets nosniff, `X-Frame-Options`, `Referrer-Policy`, a `default-src 'none'; sandbox` CSP, CORP and `no-store` on `/auth/*` itself; `/docs`, `/redoc`, `/openapi.json` are off in production. *Was:* No security headers or CSP on the backend itself. They only come from nginx, so a misconfigured deploy that exposes `:8000` gets none. Also disable `/docs`, `/redoc` and `/openapi.json` when `ENVIRONMENT=production`.
- **S24** ✅ *Fixed:* multi-stage image, runs as uid 1000, no compiler; compose adds `read_only`, tmpfs `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`. *Was:* The backend container runs as **root** and keeps `build-essential` in the final image. Use a multi-stage build and a non-root `USER`. Add `read_only: true` and `cap_drop: [ALL]` in compose.
- **S25** ✅ *Fixed:* nginx part earlier; now every socket has a 64 KB frame cap (uvicorn `--ws-max-size` + an app check, close 1009) and a per-socket token bucket (5/s, burst 20; voice 50/s, burst 400; close 1008). Typing is throttled to one broadcast per 2 s and the username is looked up once per connection. *Was:* `/ws` location in nginx lacks `X-Forwarded-For`/`X-Real-IP` and `proxy_read_timeout` (the 60 s default drops idle sockets). There's no WS message size or rate limit, and each typing event does a DB lookup (`ws.py:105`), which is cheap to amplify.
- **S26** ✅ *Fixed:* the use is counted with a conditional `UPDATE … WHERE uses < max_uses` before the member is added; a parallel double-join by the same user doesn't count twice. *Was:* Invite `uses += 1` isn't atomic, so concurrent joins exceed `max_uses`. Use `UPDATE … SET uses = uses + 1 WHERE uses < max_uses RETURNING`.
- **S27** No rate limit on `/auth/refresh`, `/decorations/redeem` (code brute force), `/users/{id}/note`, or `PATCH /me`. Notes have no length cap.
- **S28** Admins can demote, kick or ban other admins and edit the Admin role itself. There's no role hierarchy, so one compromised admin account can take over the whole server except the owner. Add position-based hierarchy.
- **S29** No dependency scanning in CI. Add `pip-audit`, `npm audit --omit=dev`, and Dependabot or Renovate. `python-jose` is barely maintained, so consider moving to `PyJWT` or `joserfc`.
  > **✅ Fixed (2026-11-26).** CI `audit` job: `pip-audit --strict` on the backend pins, `npm audit --omit=dev --audit-level=high` on the frontend. `.github/dependabot.yml` covers pip, npm, both Dockerfiles and Actions. The first scan found 42 advisories in Pillow 12.3 (bumped to 13.0) and high/moderate ones in axios, form-data, dompurify, follow-redirects and @remix-run/router (fixed via lockfile updates). Moved from python-jose to PyJWT. Tokens now must carry `exp`, and `ALGORITHM` only accepts HS256/384/512. Still open: a moderate react-router advisory that needs the v7 major (see TODO).

---

## Privacy notes (not bugs, but tell users)
- Voice/video is **P2P WebRTC with only Google STUN**, so participants see each other's public IPs. Offer a TURN relay (coturn) with "relay-only" mode for privacy.
- Revoked refresh tokens, QR sessions and audit logs are never purged. Define a retention job.
- E2EE trust: the server distributes public keys and MLS key packages. Check that users get a visible **"safety number changed"** warning when a peer's key changes. Without it, the operator can MITM.

---

## What's already good ✅
- Rotating, hashed refresh tokens with reuse detection and per-session revocation, checked on every request.
- WS auth moved out of the URL (`ws_auth.py`), with a clean contract.
- Magic-byte MIME checks, image re-encoding with dimension caps, forced download for attachments, no HTML/SVG uploads.
- DOMPurify with tight allowlists on all `dangerouslySetInnerHTML`, plus a strict `script-src 'self'` CSP and `frame-ancestors 'none'`.
- `ENVIRONMENT=production` refuses default secrets and DB credentials, and the DB isn't exposed in compose.
- Pinned Python deps, server-side password minimum, word-filter patterns not leaked, Redis-capable rate limiter.

## Suggested go-public order
1. S1, S2, S3, S4 (each is small except S3).
2. S5, S6, S8, S12 (deploy and config, about a day of work).
3. S7, S9, S10, S11, S13, S14.
4. Add a `tests/test_security.py` case for **every** item above so they can't come back.
5. Run an external scan (OWASP ZAP baseline against the deployed instance) plus `pip-audit` and `npm audit`.
