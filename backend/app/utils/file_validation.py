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
#
# SECURITY: text/html, text/xml and application/xml are intentionally NOT
# included here. Attachments are served back same-origin (see /static mount
# in main.py). If a browser were to render an uploaded HTML/XML file inline
# instead of downloading it, any script it contains would execute with the
# app's origin (stored XSS, session/token theft). Do not re-add markup MIME
# types to this allowlist without also serving attachments from an isolated
# origin and/or forcing Content-Disposition: attachment.
_FALLBACK_MIMES: Set[str] = {
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/json",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

# Content-Type prefixes that are safe to allow even without magic bytes.
# "text/" is handled separately below with an explicit denylist for markup
# types that browsers will render (and thus execute script from).
_UNSAFE_TEXT_SUBTYPES: Set[str] = {"html", "xml", "xhtml+xml", "svg+xml"}

# Maximum allowed dimensions per image purpose
AVATAR_MAX: Tuple[int, int] = (1024, 1024)
BANNER_MAX: Tuple[int, int] = (1920, 1080)
SERVER_IMAGE_MAX: Tuple[int, int] = (1920, 1080)


def _resize_image_if_needed(
    content: bytes,
    ext: str,
    max_wh: Tuple[int, int],
    label: str = "Image",
) -> bytes:
    """Downscale the image to fit within *max_wh* when it exceeds those dimensions.

    - Static images (jpg/png/webp/single-frame gif): auto-resized with LANCZOS
      resampling, returned in the same format.
    - Animated GIFs that exceed the limit: HTTP 400 is raised (multi-frame
      resizing is not supported server-side).
    - Images already within the limit: returned unchanged.
    """
    try:
        img = Image.open(io.BytesIO(content))
    except Exception:
        raise HTTPException(status_code=400, detail=f"{label} could not be opened as a valid image.")

    max_w, max_h = max_wh
    w, h = img.size

    if w <= max_w and h <= max_h:
        img.close()
        return content

    # Animated GIFs cannot be frame-resized here — reject with a clear message
    if ext == "gif":
        is_animated = False
        try:
            img.seek(1)
            is_animated = True
        except EOFError:
            pass
        if is_animated:
            img.close()
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Animated GIF dimensions {w}×{h} exceed the maximum "
                    f"{max_w}×{max_h}. Please resize it before uploading."
                ),
            )

    # thumbnail() preserves aspect ratio and never upscales
    img.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    fmt_map = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP", "gif": "GIF"}
    fmt = fmt_map.get(ext, "PNG")
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    img.close()
    return buf.getvalue()


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
    Images exceeding *max_wh* are automatically downscaled to fit (LANCZOS,
    aspect-ratio preserved). Animated GIFs that exceed the limit are rejected
    with HTTP 400.
    """
    content, ext = await verify_image_magic(file)
    content = _resize_image_if_needed(content, ext, max_wh, label)
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
    ct_subtype = ct.split("/", 1)[-1] if "/" in ct else ""
    if ct in _FALLBACK_MIMES:
        return content
    if ct.startswith("text/") and ct_subtype not in _UNSAFE_TEXT_SUBTYPES:
        return content

    raise HTTPException(
        status_code=400,
        detail="File type is not allowed as an attachment. Supported: images, audio, video, PDF, text, Office documents, and archives.",
    )
