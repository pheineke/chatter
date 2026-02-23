import os
import sys

# Ensure the backend directory is on the Python path so that `app` and `models`
# are importable when running `uvicorn main:app` from the backend/ directory.
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import auth, users, servers, channels, messages, dms, friends, invites
from app.routers import blocks as blocks_router
from app.routers import ws as ws_router
from app.routers import voice as voice_router
from app.routers import notifications as notifications_router

app = FastAPI(
    title="Chat API",
    description="Discord-inspired real-time chat backend",
    version="0.1.0",
)

# Static files (avatars, attachments, server images …)
os.makedirs(settings.static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")

# Routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(servers.router)
app.include_router(channels.router)
app.include_router(messages.router)
app.include_router(dms.router)
app.include_router(friends.router)
app.include_router(invites.router)
app.include_router(blocks_router.router)
app.include_router(notifications_router.router)
app.include_router(ws_router.router)
app.include_router(voice_router.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
