# Chat

A Discord-inspired real-time chat platform with a **FastAPI** backend and a **React** frontend. Supports servers with text and voice channels, role-based permissions, rich messaging, and private direct messages.

> **Status:** Early-stage — dependencies and feature spec are defined, implementation is underway.

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
| [React](https://react.dev/) | UI framework |
| [Vite](https://vitejs.dev/) | Dev server and bundler |
| [React Router](https://reactrouter.com/) | Client-side routing |

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

> **Note:** A database layer and the backend entry point (`main.py`) are not yet implemented. These steps will be updated as the project progresses.

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
- [ ] User registration and login (JWT)
- [ ] Avatar and profile description upload
- [ ] User status management

### Servers
- [ ] Create / edit / delete servers
- [ ] Server image and banner upload
- [ ] Role management (create, assign, delete)

### Channels
- [ ] Create text and voice channels
- [ ] Category management and reordering
- [ ] Per-role channel permissions

### Messaging
- [ ] Send, delete, and reply to messages
- [ ] Reactions
- [ ] Attachment uploads (image, GIF, audio)
- [ ] `@user` and `@role` mentions

### Voice
- [ ] WebRTC voice channel integration
- [ ] Mute / deafen controls
- [ ] Screen sharing
- [ ] Webcam support

### Direct Messages
- [ ] Private one-to-one DM threads

### Friends
- [ ] Send and receive friend requests
- [ ] Accept / decline requests
- [ ] Friends list with live status
- [ ] Remove friends
