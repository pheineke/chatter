import os
import posixpath
import sys

# Ensure the backend directory is on the Python path so that `app` and `models`
# are importable when running `uvicorn main:app` from the backend/ directory.
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.utils.signed_urls import verify_static_signature
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
from app.routers import mls as mls_router

_production = settings.environment.lower() == "production"

app = FastAPI(
    title="Chat API",
    description="Discord-inspired real-time chat backend",
    version="0.1.0",
    # The interactive docs and schema map out every endpoint for anyone who
    # finds the server; keep them for local development only (S23).
    docs_url=None if _production else "/docs",
    redoc_url=None if _production else "/redoc",
    openapi_url=None if _production else "/openapi.json",
)

# Static files (avatars, attachments, server images …)
os.makedirs(settings.static_dir, exist_ok=True)


@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    """Reject oversized bodies by Content-Length before anything parses them.

    Starlette spools a multipart body to memory/disk *before* the endpoint
    runs, so the per-file caps in app/utils/file_validation.py alone would
    still let a client push nginx's whole client_max_body_size through.
    (Bodies without Content-Length are bounded by nginx and by the per-file
    chunked reads.)
    """
    length = request.headers.get("content-length")
    if length is not None:
        try:
            too_big = int(length) > settings.max_request_body
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
        if too_big:
            mb = settings.max_upload_size // (1024 * 1024)
            return JSONResponse({"detail": f"Request is too large (files up to {mb} MB)."}, status_code=413)
    return await call_next(request)


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
    path = request.url.path
    rel = _static_relpath(path)
    if rel is not None and (rel == "attachments" or rel.startswith("attachments/")):
        # S22: attachments need the signed URL the API hands out.
        q = request.query_params
        if not verify_static_signature(rel, q.get("exp"), q.get("sig")):
            return JSONResponse({"detail": "This link has expired or is invalid"}, status_code=403)
        response = await call_next(request)
        filename = rel.rsplit("/", 1)[-1]
        response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        response.headers["Cache-Control"] = "private, max-age=86400"
        return response
    return await call_next(request)


def _static_relpath(path: str) -> str | None:
    """The file path StaticFiles will resolve for *path*, or None if *path*
    isn't under /static. Normalised the same way, so /static//attachments/x
    or /static/./attachments/x can't skip the signature check."""
    if path != "/static" and not path.startswith("/static/"):
        return None
    rel = posixpath.normpath(path[len("/static"):].lstrip("/") or ".")
    return "" if rel == "." else rel


# Headers on every backend response, so a deploy that exposes :8000 directly
# (no nginx in front) still gets them (S23). The API only returns JSON and
# user-uploaded files, never pages, so the CSP can forbid everything: an
# uploaded HTML/SVG opened directly can't run script or load anything.
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for name, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    if request.url.path.startswith("/auth/"):  # token responses: never cache
        response.headers.setdefault("Cache-Control", "no-store")
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
app.include_router(mls_router.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
