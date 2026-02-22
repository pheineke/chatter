"""Strip HTML tags from user-supplied text to prevent stored XSS."""
import re
from typing import Optional

# Matches any HTML/XML tag
_TAG_RE = re.compile(r'<[^>]+>')
# Matches ASCII control characters (except tab \x09, newline \x0a, carriage return \x0d)
_CONTROL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')


def strip_html(value: Optional[str]) -> Optional[str]:
    """Remove HTML/XML tags and dangerous control characters from a string."""
    if value is None:
        return None
    cleaned = _TAG_RE.sub('', value)
    cleaned = _CONTROL_RE.sub('', cleaned)
    return cleaned
