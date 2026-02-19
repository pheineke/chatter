# Chat

A Discord-inspired real-time chat platform with a **FastAPI** backend and a **React** frontend. Supports servers with text and voice channels, role-based permissions, rich messaging, and private direct messages.

> **Status:** Backend 100% complete (128 tests passing). **Frontend complete** — React/Vite/TypeScript app with full UI.

---

## Tech Stack

### Backend

| Technology | Role |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Web framework (REST + WebSocket) |
| [Uvicorn](https://www.uvicorn.org/) | ASGI server |
| [PostgreSQL](https://www.postgresql.org/) | Relational database |
| [SQLAlchemy (async)](https://docs.sqlalchemy.org/) | ORM and query layer |
| [Alembic](https://alembic.sqlalchemy.org/) | Database migrations |
| [python-jose](https://github.com/mpdavis/python-jose) | JWT authentication |
| [passlib / bcrypt](https://passlib.readthedocs.io/) | Password hashing |
| [python-multipart](https://github.com/andrew-d/python-multipart) | File upload handling |

### Frontend

| Technology | Role |
|---|---|
| [React 18](https://react.dev/) | UI framework |
| [Vite 5](https://vitejs.dev/) | Dev server and bundler |
| [TypeScript 5](https://www.typescriptlang.org/) | Type-safe JavaScript |
| [React Router v6](https://reactrouter.com/) | Client-side routing |
| [TanStack Query v5](https://tanstack.com/query) | Server state management |
| [Axios](https://axios-http.com/) | HTTP client with JWT interceptor |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first styling (Discord theme) |
| [date-fns](https://date-fns.org/) | Date formatting |

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+

### Backend

```bash
# Clone the repository
git clone https://github.com/your-username/chat.git
cd chat/backend

# Install dependencies
pip install -r requirements.txt

# Start the development server
uvicorn main:app --reload
```

### Frontend

```bash
cd chat/frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

> **Note:** Copy `backend/.env.example` to `backend/.env` and set your `DATABASE_URL` and `SECRET_KEY`, then run `alembic upgrade head` inside `backend/` to apply the schema before starting the server.

### Running Tests

The test suite uses an in-memory SQLite database so no external database is required.

```bash
cd chat/backend

# Install dependencies (includes pytest, httpx, aiosqlite)
pip install -r requirements.txt

# Run all tests
pytest

# Run with verbose output
pytest -v

# Run a specific test file
pytest tests/test_auth.py
```

---

## Project Structure

```
chat/
├── backend/
│   ├── app/              # Route handlers and application logic
│   ├── models/           # Pydantic / ORM data models
│   ├── static/           # Uploaded media (avatars, attachments, etc.)
│   ├── main.py           # Entry point (planned)
│   └── requirements.txt
└── frontend/
    ├── public/           # Static assets
    ├── src/
    │   ├── components/   # Reusable UI components
    │   ├── pages/        # Route-level page components
    │   ├── hooks/        # Custom React hooks
    │   └── main.jsx      # App entry point
    └── package.json
```

---

## Features

### Users

- Unique UUID for authentication
- Username and bcrypt-hashed password
- Avatar (image / GIF)
- Profile description
- Status indicator: **Online** (green), **Away** (orange), **Busy** (red), **Offline/Invisible** (grey)

### Servers

- Title, description, image/GIF, and banner image/GIF
- Text channels and voice channels
- Role system: built-in Admin role + custom roles

### Text Channels

- Title and description
- Role-based permissions:
  - Which roles can **read** the channel
  - Which roles can **write** in the channel
  - Which roles can **edit** the channel description
- Users can mute individual channels

### Voice Channels

- Title
- Users can connect and speak with each other
- Mute and deafen controls
- Screen share visible to all connected users
- Webcam feed visible to all connected users

### Categories

- Group text and voice channels for organisation
- Collapsible / expandable
- Title
- Fully reorderable — moving a category also moves its contained channels

### Messages

- Content, author, and creation timestamp
- Reactions with per-reaction user lists
- Replies to other messages
- Deletable by the message creator or a server admin
- Attachments: images and GIFs are displayed inline; audio is playable in-browser
- `@user` and `@role` mentions

### Private DMs

- One-to-one private messaging between two users
- Separate from all servers

### Friends

- Send and receive friend requests
- Accept or decline incoming requests
- View a friends list with live status indicators
- Remove friends

---

## Roadmap

### Authentication & Users
- [x] User registration and login (JWT)
- [x] Avatar and profile description upload
- [x] User status management

### Servers
- [x] Create / edit / delete servers
- [x] Server image and banner upload
- [x] Role management (create, assign, delete)

### Channels
- [x] Create text and voice channels
- [x] Category management and reordering
- [x] Per-role channel permissions

### Messaging
- [x] Send, delete, and reply to messages
- [x] Reactions
- [x] Attachment uploads (image, GIF, audio)
- [x] `@user` and `@role` mentions

### Real-time Events (WebSockets)
- [x] WebSocket connection manager (channel / server / user rooms)
- [x] Channel message events (`message.created`, `message.updated`, `message.deleted`, `reaction.added`, `reaction.removed`)
- [x] Server membership events (`server.member_joined`, `server.member_left`, `server.member_kicked`)
- [x] Role events (`role.created`, `role.updated`, `role.deleted`)
- [x] DM events (`dm.created`, `dm.deleted`)
- [x] Friend-request events (`friend_request.received`, `friend_request.accepted`, `friend_request.declined`)

### Voice
- [x] WebRTC voice channel signaling (offer / answer / ICE relay via WebSocket)
- [x] Mute / deafen controls (server-side state broadcast)
- [x] Screen sharing (signaling support for display-capture tracks)
- [x] Webcam support (signaling support for video tracks)
- [ ] WebRTC media (requires frontend + browser APIs — server is signaling-only)

### Direct Messages
- [x] Private one-to-one DM threads

### Friends
- [x] Send and receive friend requests
- [x] Accept / decline requests
- [x] Friends list with live status
- [x] Remove friends

### Tests
- [x] Auth — register, login, duplicate, bad token
- [x] Users — profile read/update, avatar upload, user lookup
- [x] Servers — CRUD, membership, role CRUD, role assignment
- [x] Channels — category CRUD, channel CRUD, permissions, mute/unmute
- [x] Messages — send, list, pagination, edit, delete, reply, reactions, attachments
- [x] Direct Messages — send, list, delete, attachments
- [x] Friends — send request, list, accept, decline, friends list, remove
- [x] `@user`/`@role` mention parsing
- [x] WebSocket connection manager (unit tests)
- [x] WebSocket endpoint integration tests (auth, channel subscription, real-time broadcast)
- [x] Voice (WebRTC) signaling tests (21 tests — manager unit tests + WS integration tests)
