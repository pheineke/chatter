# Chat

A Discord-inspired real-time chat platform built with **FastAPI**. Supports servers with text and voice channels, role-based permissions, rich messaging, and private direct messages.

> **Status:** Early-stage — dependencies and feature spec are defined, implementation is underway.

---

## Tech Stack

| Technology | Role |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Web framework (REST + WebSocket) |
| [Uvicorn](https://www.uvicorn.org/) | ASGI server |
| [python-jose](https://github.com/mpdavis/python-jose) | JWT authentication |
| [passlib / bcrypt](https://passlib.readthedocs.io/) | Password hashing |
| [python-multipart](https://github.com/andrew-d/python-multipart) | File upload handling |

---

## Getting Started

### Prerequisites

- Python 3.10+

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/chat.git
cd chat

# Install dependencies
pip install -r requirements.txt
```

### Running the Development Server

```bash
uvicorn main:app --reload
```

> **Note:** A database layer and entry point (`main.py`) are not yet implemented. This step will be updated as the project progresses.

---

## Project Structure

```
chat/
├── app/          # Route handlers and application logic
├── models/       # Pydantic / ORM data models
├── static/       # Frontend assets and uploaded media
├── main.py       # Entry point (planned)
└── requirements.txt
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
