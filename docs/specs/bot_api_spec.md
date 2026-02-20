# Bot / API Access Specification

## 1. Overview

Allow users to generate personal API tokens to interact with the chat platform programmatically — sending messages, reading history, reacting to events. This enables Discord-style bots written in Python (or any HTTP client) to operate inside the chat app.

Authentication uses a `Authorization: Bot <token>` header. Tokens act on behalf of the user who created them (they are personal access tokens, not OAuth2 app tokens).

---

## 2. Token Model

### 2.1 Database — `api_token` table

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → users | owner |
| `name` | varchar(100) | human label, e.g. "My Bot" |
| `token_hash` | varchar(128) | SHA-256 of the raw token (never stored raw) |
| `token_prefix` | varchar(8) | first 8 chars of raw token, shown in UI for identification |
| `created_at` | timestamptz | |
| `last_used_at` | timestamptz | nullable, updated on each authenticated request |
| `revoked` | boolean | default false |

### 2.2 Token format

```
<prefix8>.<random56_urlsafe_base64>
```

Total length ~65 chars. The prefix is derivable from the raw token for display. Example:

```
aB3kRt9x.Zq8mNpL2wXvYsUjKdHeGbFcTaIoMrEnWqBlCzAxDyPuV
```

### 2.3 Limits

- Max **5 active tokens** per user.
- Tokens never expire (user must revoke manually).
- Raw token shown **once** at creation — not stored server-side.

---

## 3. Authentication

### 3.1 Header

```
Authorization: Bot aB3kRt9x.Zq8mNpL2wXvYsUjKdHeGbFcTaIoMrEnWqBlCzAxDyPuV
```

### 3.2 Resolution flow

1. Parse `Authorization` header — if starts with `Bot `, extract token.
2. Compute SHA-256 of token.
3. Look up `api_token` where `token_hash = hash AND revoked = false`.
4. Fetch associated `user` — this is the "acting user" for this request.
5. Update `last_used_at` asynchronously.
6. Inject user into request dependencies (same `get_current_user` path as session auth).

### 3.3 Scope

Bot tokens have the same permissions as the user who owns them. A bot cannot join servers, change roles, or perform admin actions the user couldn't perform.

---

## 4. REST Endpoints (Bot-accessible)

All existing authenticated endpoints accept Bot tokens. The following are the primary bot-relevant ones:

### 4.1 Messages

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/channels/{channel_id}/messages` | Fetch message history |
| `POST` | `/api/channels/{channel_id}/messages` | Send a message |
| `DELETE` | `/api/messages/{message_id}` | Delete own message |
| `PATCH` | `/api/messages/{message_id}` | Edit own message |

#### GET `/api/channels/{channel_id}/messages`

Query params:
- `limit` — int, 1–100, default 50
- `before` — message UUID, for pagination

Response:
```json
[
  {
    "id": "uuid",
    "content": "Hello world",
    "author": { "id": "uuid", "username": "Alice", "avatar": "..." },
    "created_at": "2026-02-20T10:00:00Z",
    "edited_at": null,
    "attachments": []
  }
]
```

#### POST `/api/channels/{channel_id}/messages`

```json
{ "content": "Hello from the bot!" }
```

Response: created message object (201).

### 4.2 Channels

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/servers/{server_id}/channels` | List channels in a server |
| `GET` | `/api/channels/{channel_id}` | Get channel info |

### 4.3 Servers

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/servers` | List servers the user belongs to |
| `GET` | `/api/servers/{server_id}` | Get server info |
| `GET` | `/api/servers/{server_id}/members` | List members |

### 4.4 Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users/me` | Get own user profile |

### 4.5 Direct Messages

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dms` | List DM conversations |
| `GET` | `/api/dms/{user_id}/messages` | Fetch DM history |
| `POST` | `/api/dms/{user_id}/messages` | Send DM |

---

## 5. WebSocket Gateway (optional, read-only events)

Bots may connect to the WS gateway to receive real-time events.

```
ws://host/ws?token=<raw_token>
```

> ⚠ Token passed as query param over HTTPS/WSS only. Over plain HTTP this is insecure.

### 5.1 Supported incoming events (server → bot)

| Event type | Payload |
|---|---|
| `message_create` | Full message object |
| `message_update` | `{ id, content, edited_at }` |
| `message_delete` | `{ id, channel_id }` |
| `member_join` | Member object |
| `member_leave` | `{ user_id, server_id }` |
| `presence_update` | `{ user_id, status }` |

### 5.2 Heartbeat

Client must send `{"type":"ping"}` every 30 s. Server replies `{"type":"pong"}`.

---

## 6. Token Management API

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/users/me/tokens` | session | List tokens (prefix + name, no hash) |
| `POST` | `/api/users/me/tokens` | session | Create token — returns raw token **once** |
| `DELETE` | `/api/users/me/tokens/{token_id}` | session | Revoke token |

### POST `/api/users/me/tokens`

Request:
```json
{ "name": "My Bot" }
```

Response (201):
```json
{
  "id": "uuid",
  "name": "My Bot",
  "token": "aB3kRt9x.Zq8mNpL2...",
  "token_prefix": "aB3kRt9x",
  "created_at": "2026-02-20T10:00:00Z"
}
```

The `token` field is **only present in this response**. It is not stored and cannot be retrieved again.

---

## 7. Settings Page — "API Tokens"

New tab in account settings (between "Profile" and "Voice & Video"):

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  API Tokens                                             │
│  Use these tokens to access the API programmatically.   │
│  Treat them like passwords — never share them.          │
│                                                         │
│  [+ Create Token]                          (0/5 used)  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  My Bot          aB3kRt9x···   Last used: 2h ago │   │
│  │                                         [Revoke] │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Create Token flow

1. Click **Create Token** → modal opens.
2. User enters a name (required, max 100 chars).
3. On submit → POST `/api/users/me/tokens`.
4. Modal shows a **one-time reveal** panel:
   - Full token in a monospace read-only input.
   - **Copy** button (copies to clipboard).
   - Warning: *"This token will not be shown again."*
5. User closes modal — token disappears.

### 7.3 Token list

Each entry shows:
- Token name
- Prefix (`aB3kRt9x···`)
- Last used (`never` / relative time)
- **Revoke** button → confirm modal → DELETE request

---

## 8. Python Bot Example

```python
import httpx

BASE = "http://localhost:8000"
TOKEN = "aB3kRt9x.Zq8mNpL2..."
HEADERS = {"Authorization": f"Bot {TOKEN}"}

# Send a message
resp = httpx.post(
    f"{BASE}/api/channels/<channel_id>/messages",
    json={"content": "Hello from the bot!"},
    headers=HEADERS,
)
print(resp.json())

# Read last 10 messages
msgs = httpx.get(
    f"{BASE}/api/channels/<channel_id>/messages?limit=10",
    headers=HEADERS,
).json()
for m in msgs:
    print(m["author"]["username"], ":", m["content"])
```

---

## 9. Security Considerations

- Tokens are hashed (SHA-256) before storage — a DB breach does not leak usable tokens.
- Rate limit bot requests: 30 req/s per token (same as session users).
- `last_used_at` lets users spot unused/leaked tokens.
- WS token auth should only be used over WSS.
- Tokens are scoped to the owning user — no way to escalate beyond user permissions.
