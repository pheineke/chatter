import os
import sys

# Ensure the backend directory is on the Python path so that `app` and `models`
# are importable when running `uvicorn main:app` from the backend/ directory.
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import auth, users, servers, channels, messages, dms, friends, invites
from app.routers import blocks as blocks_router
from app.routers import ws as ws_router
from app.routers import voice as voice_router
from app.routers import notifications as notifications_router
from app.routers import meta as meta_router
from app.routers import tokens as tokens_router
from app.routers import decorations as decorations_router
from app.routers import e2ee as e2ee_router
from app.routers import audit_logs as audit_logs_router
from app.routers import interactions as interactions_router

app = FastAPI(
    title="Chat API",
    description="Discord-inspired real-time chat backend",
    version="0.1.0",
)

# Static files (avatars, attachments, server images …)
os.makedirs(settings.static_dir, exist_ok=True)


@app.middleware("http")
async def force_attachment_download(request: Request, call_next):
    """Force Content-Disposition: attachment on user-uploaded message
    attachments so browsers never render them inline in the app's origin.

    Defense in depth alongside the MIME allowlist in
    app/utils/file_validation.py: even if a mislabelled or future file type
    slipped through validation, a direct/copy-pasted URL to it will prompt a
    download instead of executing as HTML/script in our origin.
    Avatars/banners/server images are excluded — they're always
    magic-byte-verified images and are rendered via <img>, which is
    unaffected by Content-Disposition.
    """
    response = await call_next(request)
    if request.url.path.startswith("/static/attachments/"):
        filename = request.url.path.rsplit("/", 1)[-1]
        response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


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
app.include_router(meta_router.router)
app.include_router(tokens_router.router)
app.include_router(decorations_router.router)
app.include_router(e2ee_router.router)
app.include_router(audit_logs_router.router)
app.include_router(interactions_router.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
