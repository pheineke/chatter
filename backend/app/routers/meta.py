"""
GET /meta?url=<url>
Server-side Open Graph / meta-tag proxy.
Fetches a URL and returns { title, description, image, url, site_name }.
All fields may be None if not found.
"""
import re
import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, HttpUrl

router = APIRouter(prefix="/meta", tags=["meta"])

TIMEOUT = 8.0  # seconds
MAX_BYTES = 512 * 1024  # 512 KB — only read the <head>

FAKE_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


class MetaResult(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    site_name: str | None = None


def _og(html: str, prop: str) -> str | None:
    """Extract an og:<prop> or twitter:<prop> content attribute."""
    patterns = [
        rf'<meta[^>]+property=["\']og:{prop}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:{prop}["\']',
        rf'<meta[^>]+name=["\']twitter:{prop}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:{prop}["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _og_title(html: str) -> str | None:
    v = _og(html, "title")
    if v:
        return v
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return m.group(1).strip() if m else None


def _og_description(html: str) -> str | None:
    v = _og(html, "description")
    if v:
        return v
    m = re.search(
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE,
    )
    return m.group(1).strip() if m else None


@router.get("", response_model=MetaResult)
async def get_meta(url: str = Query(..., description="URL to fetch OG data for")):
    # Only allow http/https
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Only http/https URLs are supported")

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=TIMEOUT,
            headers={"User-Agent": FAKE_UA, "Accept-Language": "en-US,en;q=0.9"},
        ) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    raise HTTPException(status_code=502, detail=f"Upstream returned {resp.status_code}")
                content_type = resp.headers.get("content-type", "")
                if "text/html" not in content_type:
                    raise HTTPException(status_code=422, detail="URL does not point to an HTML page")
                # Read only up to MAX_BYTES so we don't pull full pages
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes(4096):
                    chunks.append(chunk)
                    total += len(chunk)
                    if total >= MAX_BYTES:
                        break
                html = b"".join(chunks).decode("utf-8", errors="replace")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Request to upstream timed out")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch URL: {exc}")

    image = _og(html, "image")
    # Resolve relative image URLs
    if image and image.startswith("/"):
        from urllib.parse import urlparse
        parsed = urlparse(url)
        image = f"{parsed.scheme}://{parsed.netloc}{image}"

    return MetaResult(
        url=url,
        title=_og_title(html),
        description=_og_description(html),
        image=image,
        site_name=_og(html, "site_name"),
    )
