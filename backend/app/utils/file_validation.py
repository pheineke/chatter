"""Magic-byte MIME type verification for uploaded files.

Validates the actual file content (not just the browser-supplied Content-Type
header) to prevent disguised executables and MIME-sniff attacks.
"""
from typing import Set

import filetype
from fastapi import HTTPException, UploadFile

_IMAGE_MIMES: Set[str] = {"image/jpeg", "image/png", "image/gif", "image/webp"}

# audio/x-wav is what filetype returns for WAV files
_ATTACHMENT_MIMES: Set[str] = _IMAGE_MIMES | {
    "audio/mpeg",
    "audio/ogg",
    "audio/x-wav",
    "audio/wav",
}


async def verify_image_magic(file: UploadFile) -> bytes:
    """Read the entire upload, check its magic bytes, and return the raw bytes.

    Raises HTTP 400 if the file's real MIME type is not an allowed image type.
    """
    content = await file.read()
    kind = filetype.guess(content)
    if kind is None or kind.mime not in _IMAGE_MIMES:
        raise HTTPException(
            status_code=400,
            detail="File content does not match an allowed image type (jpeg/png/gif/webp).",
        )
    return content


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
