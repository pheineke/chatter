"""Signed, expiring URLs for message attachments (security_pass S22).

Attachments used to be served to anyone who had (or guessed) the path.
Now the API hands out `/static/<path>?exp=<unix>&sig=<hmac>` and the static
handler refuses attachment requests without a valid, unexpired signature.
Like Discord's CDN links, a URL works for whoever holds it until it expires;
it just stops working afterwards, and can't be made up from a path alone.

Expiry is rounded up to whole UTC days so the same attachment gets the same
URL all day (browser and query caches keep working); a URL is valid for at
least ATTACHMENT_URL_TTL and less than one day longer.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import quote

from app.config import settings

ATTACHMENT_URL_TTL = 24 * 3600
_BUCKET = 24 * 3600


def _key() -> bytes:
    # Derived, so a leaked URL signature says nothing about the JWT key.
    return hmac.new(settings.secret_key.encode(), b"static-url-signing", hashlib.sha256).digest()


def _sig(path: str, exp: int) -> str:
    mac = hmac.new(_key(), f"{path}\n{exp}".encode(), hashlib.sha256).hexdigest()
    return mac[:32]


def signed_static_url(path: str, *, now: float | None = None) -> str:
    """URL (relative to the API root) for the static file at *path*."""
    now = time.time() if now is None else now
    exp = int(-(-(now + ATTACHMENT_URL_TTL) // _BUCKET) * _BUCKET)
    return f"/static/{quote(path)}?exp={exp}&sig={_sig(path, exp)}"


def verify_static_signature(path: str, exp: str | None, sig: str | None, *, now: float | None = None) -> bool:
    if not exp or not sig or not exp.isdigit():
        return False
    exp_i = int(exp)
    if exp_i < (time.time() if now is None else now):
        return False
    return hmac.compare_digest(sig, _sig(path, exp_i))


# ── Remote image proxy (security_pass S16) ────────────────────────────────────
#
# Remote images (link-preview thumbnails, image links in messages) are loaded
# through GET /meta/image so viewers' browsers never contact the remote host.
# The proxy only fetches URLs the API signed for a logged-in user, so it
# can't be used as an open proxy by anyone who finds the endpoint.

IMAGE_PROXY_TTL = 24 * 3600


def _proxy_key() -> bytes:
    return hmac.new(settings.secret_key.encode(), b"image-proxy-signing", hashlib.sha256).digest()


def _proxy_sig(url: str, exp: int) -> str:
    return hmac.new(_proxy_key(), f"{url}\n{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def signed_image_proxy_url(url: str, *, now: float | None = None) -> str:
    """Path (relative to the API root) that serves *url* through the proxy.
    Bucketed by day like attachment URLs, so it stays cacheable."""
    now = time.time() if now is None else now
    exp = int(-(-(now + IMAGE_PROXY_TTL) // _BUCKET) * _BUCKET)
    return f"/meta/image?url={quote(url, safe='')}&exp={exp}&sig={_proxy_sig(url, exp)}"


def verify_image_proxy_signature(url: str, exp: str | None, sig: str | None, *, now: float | None = None) -> bool:
    if not exp or not sig or not exp.isdigit():
        return False
    exp_i = int(exp)
    if exp_i < (time.time() if now is None else now):
        return False
    return hmac.compare_digest(sig, _proxy_sig(url, exp_i))
