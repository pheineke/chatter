"""Upload limits (docs/security_pass.md S8, S22)."""
import io

import pytest
from httpx import AsyncClient
from PIL import Image

from app.config import settings
from tests.conftest import create_channel, create_server, send_message


@pytest.fixture()
async def chan(client: AsyncClient, alice_headers):
    s = await create_server(client, alice_headers)
    ch = await create_channel(client, alice_headers, s["id"])
    return s["id"], ch["id"]


async def _upload(client, headers, channel_id, name, data, ctype="text/plain", message_id=None):
    if message_id is None:
        message_id = (await send_message(client, headers, channel_id, "file"))["id"]
    return await client.post(
        f"/channels/{channel_id}/messages/{message_id}/attachments",
        files={"file": (name, data, ctype)},
        headers=headers,
    )


def _png(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("1", (w, h)).save(buf, format="PNG")  # 1-bit, compresses to almost nothing
    return buf.getvalue()


# ---- size caps -------------------------------------------------------------

async def test_attachment_over_size_limit_rejected(client, alice_headers, chan, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_size", 1024)
    r = await _upload(client, alice_headers, chan[1], "big.txt", b"x" * 1025)
    assert r.status_code == 413
    assert "too large" in r.json()["detail"]
    r = await _upload(client, alice_headers, chan[1], "ok.txt", b"x" * 1024)
    assert r.status_code == 200, r.text


async def test_request_body_rejected_by_content_length(client, alice_headers, chan, monkeypatch):
    """Oversized bodies are refused before the multipart parser buffers them."""
    monkeypatch.setattr(settings, "max_request_body", 2048)
    r = await _upload(client, alice_headers, chan[1], "big.txt", b"x" * 4096)
    assert r.status_code == 413
    assert "Request is too large" in r.json()["detail"]


async def test_avatar_over_size_limit_rejected(client, alice_headers, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_size", 1024)
    big = _png(64, 64) + b"\0" * 2048
    r = await client.post("/users/me/avatar", files={"file": ("a.png", big, "image/png")}, headers=alice_headers)
    assert r.status_code == 413


# ---- counts, quota, disk ---------------------------------------------------

async def test_attachments_per_message_capped(client, alice_headers, chan, monkeypatch):
    monkeypatch.setattr(settings, "max_attachments_per_message", 2)
    mid = (await send_message(client, alice_headers, chan[1], "many"))["id"]
    for i in range(2):
        r = await _upload(client, alice_headers, chan[1], f"{i}.txt", b"hi", message_id=mid)
        assert r.status_code == 200, r.text
    r = await _upload(client, alice_headers, chan[1], "3.txt", b"hi", message_id=mid)
    assert r.status_code == 400
    assert "at most 2" in r.json()["detail"]


async def test_storage_quota_enforced(client, alice_headers, chan, monkeypatch):
    monkeypatch.setattr(settings, "user_storage_quota_mb", 1)
    chunk = b"x" * (600 * 1024)
    assert (await _upload(client, alice_headers, chan[1], "a.txt", chunk)).status_code == 200
    r = await _upload(client, alice_headers, chan[1], "b.txt", chunk)
    assert r.status_code == 413
    assert "quota" in r.json()["detail"]


async def test_uploads_paused_when_disk_low(client, alice_headers, chan, monkeypatch):
    monkeypatch.setattr(settings, "min_free_disk_mb", 10**9)  # more than any disk has
    r = await _upload(client, alice_headers, chan[1], "a.txt", b"hi")
    assert r.status_code == 507


# ---- content checks --------------------------------------------------------

async def test_decompression_bomb_rejected(client, alice_headers, chan):
    bomb = _png(10_000, 5_000)  # 50 MP declared, a few KB on disk
    assert len(bomb) < 100_000
    r = await _upload(client, alice_headers, chan[1], "bomb.png", bomb, "image/png")
    assert r.status_code == 400
    assert "megapixels" in r.json()["detail"]
    r = await client.post("/users/me/avatar", files={"file": ("b.png", bomb, "image/png")}, headers=alice_headers)
    assert r.status_code == 400


@pytest.mark.parametrize(
    "name,data,ctype,expected_ext",
    [
        ("evil.html", b"<script>alert(1)</script>", "text/plain", ".txt"),
        ("notes.svg", b"plain words", "text/plain", ".txt"),
        ("photo.txt", None, "text/plain", ".png"),  # real PNG bytes win over the name
        ("data.json", b'{"a": 1}', "application/json", ".json"),
    ],
)
async def test_stored_extension_comes_from_content(client, alice_headers, chan, name, data, ctype, expected_ext):
    data = _png(8, 8) if data is None else data
    r = await _upload(client, alice_headers, chan[1], name, data, ctype)
    assert r.status_code == 200, r.text
    att = r.json()["attachments"][0]
    assert att["file_path"].endswith(expected_ext), att["file_path"]
    assert att["filename"] == name  # original name kept for display


async def test_long_filename_truncated(client, alice_headers, chan):
    name = "a" * 300 + ".txt"
    r = await _upload(client, alice_headers, chan[1], name, b"hi")
    assert r.status_code == 200, r.text
    stored = r.json()["attachments"][0]["filename"]
    assert len(stored) <= 255 and stored.endswith(".txt")


async def test_font_must_be_a_font(client, alice_headers, chan):
    server_id = chan[0]
    r = await client.post(
        f"/servers/{server_id}/font",
        data={"name": "Evil Font"},
        files={"file": ("x.woff", b"<html>not a font</html>", "font/woff")},
        headers=alice_headers,
    )
    assert r.status_code == 400
    assert "not a valid" in r.json()["detail"]


# ---- S22: attachments only via signed URLs ----------------------------------

async def _uploaded(client, headers, chan):
    r = await _upload(client, headers, chan[1], "note.txt", b"secret contents")
    assert r.status_code == 200, r.text
    return r.json()["attachments"][0]


async def test_attachment_served_via_signed_url(client, alice_headers, chan):
    att = await _uploaded(client, alice_headers, chan)
    assert att["url"].startswith(f"/static/{att['file_path']}?exp=")
    r = await client.get(att["url"])  # no auth header needed: the signature is the capability
    assert r.status_code == 200
    assert r.content == b"secret contents"
    assert r.headers["content-disposition"].startswith("attachment")


@pytest.mark.parametrize("mangle", [
    lambda a: f"/static/{a['file_path']}",                                   # bare path
    lambda a: a["url"].replace("sig=", "sig=0"),                             # tampered
    lambda a: a["url"].split("&sig=")[0] + "&sig=" + "0" * 32,               # forged
    lambda a: f"/static//{a['file_path']}",                                  # path tricks
    lambda a: f"/static/./{a['file_path']}",
    lambda a: f"/static/avatars/../{a['file_path']}",
])
async def test_attachment_without_valid_signature_refused(client, alice_headers, chan, mangle):
    att = await _uploaded(client, alice_headers, chan)
    r = await client.get(mangle(att))
    assert r.status_code == 403, (mangle(att), r.status_code)


def test_signed_url_expires():
    from app.utils.signed_urls import ATTACHMENT_URL_TTL, signed_static_url, verify_static_signature

    t0 = 1_800_000_000
    url = signed_static_url("attachments/x/y.txt", now=t0)
    exp = url.split("exp=")[1].split("&")[0]
    sig = url.split("sig=")[1]
    assert int(exp) >= t0 + ATTACHMENT_URL_TTL
    assert verify_static_signature("attachments/x/y.txt", exp, sig, now=t0 + 3600)
    assert not verify_static_signature("attachments/x/y.txt", exp, sig, now=int(exp) + 1)
    assert not verify_static_signature("attachments/x/other.txt", exp, sig, now=t0)
    # Same URL for the whole day, so caches keep working.
    assert signed_static_url("attachments/x/y.txt", now=t0 + 60) == url


async def test_avatars_stay_public(client, alice_headers):
    r = await client.post("/users/me/avatar", files={"file": ("a.png", _png(16, 16), "image/png")}, headers=alice_headers)
    assert r.status_code == 200, r.text
    path = r.json()["avatar"]
    assert (await client.get(f"/static/{path}")).status_code == 200
