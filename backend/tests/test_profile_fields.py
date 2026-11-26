"""Profile fields that end up in CSS (security_pass S17)."""
import json

import pytest
from httpx import AsyncClient

from tests.conftest import register_and_login


async def test_banner_cannot_be_set_via_patch(client: AsyncClient):
    h = await register_and_login(client, "bannerless", "bannerpass1")
    r = await client.patch(
        "/users/me", json={"banner": "x.png), url(https://evil.example/t.gif"}, headers=h
    )
    assert r.status_code == 200  # unknown field ignored
    assert r.json()["banner"] is None


async def test_valid_theme_is_stored(client: AsyncClient):
    h = await register_and_login(client, "themer", "themerpass1")
    colors = {"accent": "#a78bfa", "bg": "#1c1c22", "text": "#E4E3EB"}
    r = await client.patch(
        "/users/me", json={"theme_preset": "softpop-2", "theme_colors": json.dumps(colors)}, headers=h
    )
    assert r.status_code == 200, r.text
    assert json.loads(r.json()["theme_colors"]) == colors
    r = await client.patch("/users/me", json={"theme_colors": "null"}, headers=h)
    assert r.status_code == 200 and r.json()["theme_colors"] is None


@pytest.mark.parametrize("bad", [
    '{"accent": "red; } body { background: url(https://evil.example/t.gif) }"}',
    '{"accent": "#12345"}',
    '{"bad key": "#123456"}',
    '["#123456"]',
    'not json',
    json.dumps({f"k{i}": "#123456" for i in range(21)}),
    json.dumps({"accent": "#123456", "pad": "#123456" * 200}),
])
async def test_invalid_theme_colors_rejected(client: AsyncClient, bad):
    h = await register_and_login(client, "themer2", "themerpass1")
    r = await client.patch("/users/me", json={"theme_colors": bad}, headers=h)
    assert r.status_code == 422, r.text


async def test_invalid_theme_preset_rejected(client: AsyncClient):
    h = await register_and_login(client, "themer3", "themerpass1")
    r = await client.patch("/users/me", json={"theme_preset": "<script>"}, headers=h)
    assert r.status_code == 422
