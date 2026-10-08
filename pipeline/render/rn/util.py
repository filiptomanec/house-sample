"""Small helpers: logging with a time stamp, paths of the repository, environment lookups, seeded random numbers."""
from __future__ import annotations

import os
import random
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER_DIR = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(RENDER_DIR, "..", ".."))
T0 = time.time()


def log(*a):
    print("[render %6.1fs]" % (time.time() - T0), *a, flush=True)


def repo_path(*parts):
    return os.path.join(REPO, *parts)


def env_path(name, candidates):
    """Path from the environment variable `name`, else the first existing candidate, else the last one."""
    v = os.environ.get(name)
    if v:
        return v
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return candidates[-1] if candidates else None


def which(cmd):
    return shutil.which(cmd)


def rng(*key):
    """Independent random generator per element: the same key always gives the same numbers, whatever else was built."""
    return random.Random("|".join(str(k) for k in key))


def hex_to_linear(h):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def smoothstep(e0, e1, x):
    """Smooth step from 0 at e0 to 1 at e1 (e0 may be greater than e1: falling edge)."""
    if e0 == e1:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def argv_after_dashes():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def strip_jpeg_metadata(path):
    """Removes the comment and the application segments (Exif, XMP, Blender statistics) from a JPEG; keeps JFIF and the colour
    profile (APP2 ICC) so that the picture looks the same. Pure Python."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:2] != b"\xff\xd8":
        return False
    out = bytearray(b"\xff\xd8")
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            break
        marker = data[i + 1]
        if marker == 0xDA:                       # start of scan: the rest is image data
            out += data[i:]
            break
        length = int.from_bytes(data[i + 2:i + 4], "big")
        seg = data[i:i + 2 + length]
        keep = not (marker == 0xFE or (0xE1 <= marker <= 0xEF and not (marker == 0xE2 and seg[4:16] == b"ICC_PROFILE\0")))
        if keep:
            out += seg
        i += 2 + length
    with open(path, "wb") as f:
        f.write(bytes(out))
    return True
