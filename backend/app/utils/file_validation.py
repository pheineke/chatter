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

    Raises HTTP 400 if the file's real MIME type is not an allowed attachment type.
    """
    content = await file.read()
    kind = filetype.guess(content)
    if kind is None or kind.mime not in _ATTACHMENT_MIMES:
        raise HTTPException(
            status_code=400,
            detail="File content does not match an allowed attachment type (image or audio).",
        )
    return content
