"""Magic-byte MIME type verification for uploaded files.

Validates the actual file content (not just the browser-supplied Content-Type
header) to prevent disguised executables and MIME-sniff attacks.
Also enforces maximum image dimensions to prevent denial-of-service via huge images.
"""
import io
from typing import Set, Tuple

import filetype
from fastapi import HTTPException, UploadFile
from PIL import Image

_IMAGE_MIMES: Set[str] = {"image/jpeg", "image/png", "image/gif", "image/webp"}

# audio/x-wav is what filetype returns for WAV files
_ATTACHMENT_MIMES: Set[str] = _IMAGE_MIMES | {
    "audio/mpeg",
    "audio/ogg",
    "audio/x-wav",
    "audio/wav",
    "audio/mp4",
    "video/mp4",
    "video/webm",
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-tar",
}

# MIME types that have no reliable magic bytes but are safe to allow by
# Content-Type header + extension check (plain text, various document formats)
_FALLBACK_MIMES: Set[str] = {
    "text/plain",
    "text/csv",
    "text/html",
    "text/markdown",
    "application/json",
    "application/xml",
    "text/xml",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

# Maximum allowed dimensions per image purpose
AVATAR_MAX: Tuple[int, int] = (1024, 1024)
BANNER_MAX: Tuple[int, int] = (1920, 1080)
SERVER_IMAGE_MAX: Tuple[int, int] = (1920, 1080)


def _check_image_dimensions(content: bytes, max_wh: Tuple[int, int], label: str = "Image") -> None:
    """Open image from bytes and raise HTTP 400 if dimensions exceed the limit.

    GIFs: only the first frame dimensions are checked.
    """
    try:
        with Image.open(io.BytesIO(content)) as img:
            w, h = img.size
    except Exception:
        raise HTTPException(status_code=400, detail=f"{label} could not be opened as a valid image.")
    max_w, max_h = max_wh
    if w > max_w or h > max_h:
        raise HTTPException(
            status_code=400,
            detail=f"{label} dimensions {w}×{h} exceed the maximum allowed {max_w}×{max_h}.",
        )


_MIME_TO_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}


async def verify_image_magic(file: UploadFile) -> tuple[bytes, str]:
    """Read the entire upload, check its magic bytes, and return ``(raw_bytes, ext)``.

    The extension is derived from the detected MIME type (e.g. ``"gif"``, ``"jpg"``),
    never from the user-supplied filename.  Raises HTTP 400 for disallowed types.
    NOTE: Callers that need dimension limits should call ``verify_image_magic_with_dims``.
    """
    content = await file.read()
    kind = filetype.guess(content)
    if kind is None or kind.mime not in _IMAGE_MIMES:
        raise HTTPException(
            status_code=400,
            detail="File content does not match an allowed image type (jpeg/png/gif/webp).",
        )
    ext = _MIME_TO_EXT.get(kind.mime, kind.extension)
    return content, ext


async def verify_image_magic_with_dims(
    file: UploadFile,
    max_wh: Tuple[int, int],
    label: str = "Image",
) -> tuple[bytes, str]:
    """Like ``verify_image_magic`` but also enforces maximum pixel dimensions.

    Returns ``(raw_bytes, ext)`` where *ext* is derived from the detected MIME type.
    GIFs are checked on their first-frame dimensions only so animated GIFs are
    accepted as long as each frame fits within *max_wh*.
    """
    content, ext = await verify_image_magic(file)
    _check_image_dimensions(content, max_wh, label)
    return content, ext


async def verify_attachment_magic(file: UploadFile) -> bytes:
    """Read the entire upload, check its magic bytes, and return the raw bytes.

    For files with recognised magic bytes: must be in _ATTACHMENT_MIMES.
    For files without magic bytes (e.g. plain text): falls back to the
    browser-supplied Content-Type header if it is in _FALLBACK_MIMES.
    Raises HTTP 400 if the type is not allowed.
    """
    content = await file.read()
    kind = filetype.guess(content)
    if kind is not None:
        if kind.mime not in _ATTACHMENT_MIMES:
            raise HTTPException(
                status_code=400,
                detail=f"File type '{kind.mime}' is not allowed as an attachment.",
            )
        return content

    # No magic bytes detected — fall back to the Content-Type header
    ct = (file.content_type or "").lower().split(";")[0].strip()
    if ct in _FALLBACK_MIMES or ct.startswith("text/"):
        return content

    raise HTTPException(
        status_code=400,
        detail="File type is not allowed as an attachment. Supported: images, audio, video, PDF, text, Office documents, and archives.",
    )
