"""
GET /meta?url=<url>
Server-side Open Graph / meta-tag proxy for link embeds.
Fetches a URL and returns { title, description, image, url, site_name }.
All fields may be None if not found.

SSRF protection
---------------
This endpoint makes the server fetch attacker-chosen URLs, so it must never
reach anything that isn't on the public internet (the host's LAN, Docker
services such as http://backend:8000, cloud metadata at 169.254.169.254, …).

* Only authenticated users may call it, and calls are rate-limited.
* Only http/https on ports 80/443.
* The check happens in the **network layer** (`_PublicOnlyBackend`): every
  TCP connection, including each redirect hop, resolves the hostname itself,
  rejects it if *any* resolved address is non-public, and then connects to
  the vetted IP literal. That defeats DNS rebinding (the name can't resolve
  to a public IP for a pre-check and a private one for the connect). TLS
  still verifies the certificate against the original hostname.
* Environment proxies are ignored (`trust_env=False`) so they can't bypass this.
* Upstream error details are never echoed back to the caller.
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
import typing
from urllib.parse import urljoin, urlparse

import httpcore
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.dependencies import CurrentUser
from app.rate_limiter import rate_limit_link_preview

router = APIRouter(prefix="/meta", tags=["meta"])

TIMEOUT = 8.0  # seconds
MAX_BYTES = 512 * 1024  # 512 KB — only read the <head>
MAX_REDIRECTS = 3
MAX_URL_LENGTH = 2048
ALLOWED_PORTS = {80, 443}

FAKE_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


class BlockedDestination(Exception):
    """Raised when a URL resolves to a non-public address or disallowed port."""


def is_public_ip(ip: str) -> bool:
    """True only for globally routable unicast addresses."""
    try:
        addr = ipaddress.ip_address(ip.split("%", 1)[0])  # strip IPv6 zone id
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        # ::ffff:10.0.0.1 and 64:ff9b::/96 (NAT64) embed IPv4 addresses
        if addr.ipv4_mapped is not None:
            addr = addr.ipv4_mapped
        elif addr in ipaddress.ip_network("64:ff9b::/96"):
            addr = ipaddress.IPv4Address(addr.packed[-4:])
    return addr.is_global and not addr.is_multicast


async def _resolve_public(host: str, port: int) -> list[str]:
    """Resolve *host* and return its addresses, or raise if any is non-public."""
    if port not in ALLOWED_PORTS:
        raise BlockedDestination(f"port {port} not allowed")
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise httpcore.ConnectError(f"could not resolve {host}") from exc
    ips = list(dict.fromkeys(info[4][0] for info in infos))
    if not ips or not all(is_public_ip(ip) for ip in ips):
        raise BlockedDestination(f"{host} resolves to a non-public address")
    return ips


class _PublicOnlyBackend(httpcore.AsyncNetworkBackend):
    """httpcore network backend that only opens TCP connections to public IPs."""

    def __init__(self) -> None:
        self._inner = httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: typing.Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        ips = await _resolve_public(host, port)
        last_exc: Exception | None = None
        for ip in ips:
            try:
                return await self._inner.connect_tcp(
                    ip, port, timeout=timeout, local_address=local_address,
                    socket_options=socket_options,
                )
            except httpcore.ConnectError as exc:
                last_exc = exc
        raise last_exc or httpcore.ConnectError("connection failed")

    async def connect_unix_socket(self, *args, **kwargs):  # pragma: no cover
        raise BlockedDestination("unix sockets not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class _PublicOnlyTransport(httpx.AsyncHTTPTransport):
    def __init__(self) -> None:
        super().__init__(trust_env=False)
        # Swap in a pool that uses the guarded backend. Same settings httpx
        # would use, just with our network layer.
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(),
            max_connections=10,
            http1=True,
            http2=False,
            network_backend=_PublicOnlyBackend(),
        )


def _validate_url(url: str) -> None:
    if len(url) > MAX_URL_LENGTH:
        raise HTTPException(status_code=400, detail="URL is too long")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Only http/https URLs are supported")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="URLs with credentials are not supported")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid URL")
    if port not in ALLOWED_PORTS:
        raise HTTPException(status_code=400, detail="Only ports 80 and 443 are supported")


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


async def _fetch_head(url: str) -> tuple[str, str]:
    """Fetch up to MAX_BYTES of an HTML page. Returns (final_url, html)."""
    async with httpx.AsyncClient(
        transport=_PublicOnlyTransport(),
        follow_redirects=True,
        max_redirects=MAX_REDIRECTS,
        timeout=TIMEOUT,
        trust_env=False,
        headers={"User-Agent": FAKE_UA, "Accept-Language": "en-US,en;q=0.9"},
    ) as client:
        async with client.stream("GET", url) as resp:
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail="Upstream returned an error")
            if "text/html" not in resp.headers.get("content-type", ""):
                raise HTTPException(status_code=422, detail="URL does not point to an HTML page")
            chunks: list[bytes] = []
            total = 0
            async for chunk in resp.aiter_bytes(4096):
                chunks.append(chunk)
                total += len(chunk)
                if total >= MAX_BYTES:
                    break
            return str(resp.url), b"".join(chunks).decode("utf-8", errors="replace")


@router.get("", response_model=MetaResult)
async def get_meta(
    current_user: CurrentUser,
    url: str = Query(..., description="URL to fetch OG data for"),
    _rl: None = Depends(rate_limit_link_preview),
):
    _validate_url(url)

    try:
        final_url, html = await _fetch_head(url)
    except HTTPException:
        raise
    except BlockedDestination:
        raise HTTPException(status_code=400, detail="URL is not allowed")
    except httpx.TooManyRedirects:
        raise HTTPException(status_code=502, detail="Too many redirects")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Request to upstream timed out")
    except (httpx.HTTPError, httpcore.ConnectError, OSError):
        raise HTTPException(status_code=502, detail="Failed to fetch URL")

    image = _og(html, "image")
    if image:
        image = urljoin(final_url, image)
        if urlparse(image).scheme not in ("http", "https"):
            image = None

    return MetaResult(
        url=url,
        title=_og_title(html),
        description=_og_description(html),
        image=image,
        site_name=_og(html, "site_name"),
    )
