"""Remote images go through a signed proxy (security_pass S16)."""
import io
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from PIL import Image

from app.routers import meta as meta_router
from app.utils.signed_urls import signed_image_proxy_url


def png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buf, format="PNG")
    return buf.getvalue()


PNG = png_bytes()
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


@pytest.fixture()
def upstream(monkeypatch):
    """Replace the network with canned responses; records requested URLs."""
    seen: list[str] = []
    routes: dict[str, httpx.Response] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return routes.get(str(request.url), httpx.Response(404))

    monkeypatch.setattr(meta_router, "_PublicOnlyTransport", lambda: httpx.MockTransport(handler))
    meta_router._image_cache.clear()
    meta_router._image_cache_bytes = 0
    return routes, seen


async def test_signed_image_is_proxied_with_sniffed_type(client, upstream):
    routes, seen = upstream
    routes["https://img.example/cat.png"] = httpx.Response(200, content=PNG, headers={"content-type": "text/plain"})
    r = await client.get(signed_image_proxy_url("https://img.example/cat.png"))
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"  # from magic bytes, not upstream
    assert r.content == PNG
    assert "private" in r.headers["cache-control"]

    # second request is served from the cache
    r = await client.get(signed_image_proxy_url("https://img.example/cat.png"))
    assert r.status_code == 200 and len(seen) == 1


async def test_unsigned_or_forged_requests_are_refused(client, upstream):
    _, seen = upstream
    r = await client.get("/meta/image", params={"url": "https://img.example/cat.png"})
    assert r.status_code == 403
    good = signed_image_proxy_url("https://img.example/cat.png")
    q = parse_qs(urlparse(good).query)
    r = await client.get("/meta/image", params={"url": "https://evil.example/x.png", "exp": q["exp"][0], "sig": q["sig"][0]})
    assert r.status_code == 403
    r = await client.get("/meta/image", params={"url": "https://img.example/cat.png", "exp": "1", "sig": q["sig"][0]})
    assert r.status_code == 403
    assert seen == []


@pytest.mark.parametrize(
    "body,ctype",
    [(SVG, "image/svg+xml"), (b"<html>hi</html>", "text/html"), (b"\x00" * 64, "image/png")],
)
async def test_non_raster_content_is_refused(client, upstream, body, ctype):
    routes, _ = upstream
    routes["https://img.example/x"] = httpx.Response(200, content=body, headers={"content-type": ctype})
    r = await client.get(signed_image_proxy_url("https://img.example/x"))
    assert r.status_code == 415


async def test_oversized_image_is_refused(client, upstream, monkeypatch):
    routes, _ = upstream
    monkeypatch.setattr(meta_router, "MAX_IMAGE_BYTES", 100)
    routes["https://img.example/big.png"] = httpx.Response(200, content=PNG + b"\x00" * 200)
    r = await client.get(signed_image_proxy_url("https://img.example/big.png"))
    assert r.status_code == 413


async def test_signed_private_address_still_blocked(client):
    """Signing doesn't bypass the SSRF guard (real transport here)."""
    r = await client.get(signed_image_proxy_url("http://127.0.0.1/x.png"))
    assert r.status_code == 400


async def test_link_preview_returns_proxy_path_not_remote_url(client, alice_headers, upstream):
    routes, _ = upstream
    html = '<html><head><meta property="og:title" content="T"><meta property="og:image" content="/og.png"></head></html>'
    routes["https://site.example/page"] = httpx.Response(200, text=html, headers={"content-type": "text/html"})
    r = await client.get("/meta", params={"url": "https://site.example/page"}, headers=alice_headers)
    assert r.status_code == 200, r.text
    image = r.json()["image"]
    assert image.startswith("/meta/image?url=https%3A%2F%2Fsite.example%2Fog.png&exp=")


async def test_image_urls_signs_valid_links_only(client, alice_headers):
    r = await client.post(
        "/meta/image-urls",
        json={"urls": ["https://img.example/a.png", "ftp://x/y.png", "https://img.example:8443/b.png"]},
        headers=alice_headers,
    )
    assert r.status_code == 200, r.text
    urls = r.json()["urls"]
    assert list(urls) == ["https://img.example/a.png"]
    assert urls["https://img.example/a.png"].startswith("/meta/image?")


async def test_image_urls_requires_login_and_caps_batch(client, alice_headers):
    assert (await client.post("/meta/image-urls", json={"urls": ["https://a.example/x.png"]})).status_code == 401
    r = await client.post("/meta/image-urls", json={"urls": [f"https://a.example/{i}.png" for i in range(21)]}, headers=alice_headers)
    assert r.status_code == 422
