"""Loads generated/render-inputs.json and refuses stale data (model hash and content hash, docs/RENDER-INPUTS.md)."""
from __future__ import annotations

import hashlib
import json
import math
import os

from .util import repo_path


def _fmt(v):
    if isinstance(v, float) and not math.isfinite(v):
        raise ValueError("non-finite number in render inputs")
    r = round(float(v) * 1e6) / 1e6
    s = ("%.6f" % r).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def stable_json(value, ind=""):
    """Port of stableJson in scripts/build-render-inputs.ts (the text that the content hash is computed over)."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if _is_num(value):
        return _fmt(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(_is_num(v) for v in value):
            parts = [_fmt(v) for v in value]
            if len(parts) <= 16:
                return "[" + ", ".join(parts) + "]"
            lines = [ind + "  " + ", ".join(parts[i:i + 24]) for i in range(0, len(parts), 24)]
            return "[\n" + ",\n".join(lines) + "\n" + ind + "]"
        is_point = lambda v: isinstance(v, list) and len(v) <= 4 and all(_is_num(x) for x in v)  # noqa: E731
        if len(value) <= 8 and all(is_point(v) for v in value):
            return "[" + ", ".join(stable_json(p) for p in value) + "]"
        return "[\n" + ",\n".join(ind + "  " + stable_json(v, ind + "  ") for v in value) + "\n" + ind + "]"
    entries = list(value.items())
    if not entries:
        return "{}"
    prim = lambda v: v is None or isinstance(v, (bool, str)) or _is_num(v)  # noqa: E731
    if len(entries) <= 4 and all(prim(v) for _, v in entries):
        return "{ " + ", ".join("%s: %s" % (json.dumps(k, ensure_ascii=False), stable_json(v)) for k, v in entries) + " }"
    return "{\n" + ",\n".join(ind + "  " + json.dumps(k, ensure_ascii=False) + ": " + stable_json(v, ind + "  ")
                              for k, v in entries) + "\n" + ind + "}"


def content_hash(data):
    body = {k: v for k, v in data.items() if k != "hash"}
    return hashlib.sha256(stable_json(body).encode("utf-8")).hexdigest()


def model_hash(root):
    """Hash of model/*.json (docs/HOUSE-FORMAT.md, section 8)."""
    mdir = os.path.join(root, "model")
    names = sorted(n for n in os.listdir(mdir) if n.endswith(".json") and not n.endswith(".schema.json"))
    msg = b""
    for n in names:
        with open(os.path.join(mdir, n), "rb") as f:
            msg += n.encode() + b"\0" + f.read().replace(b"\r\n", b"\n") + b"\0"
    return hashlib.sha256(msg).hexdigest()


def load(path=None, verify=True):
    path = path or repo_path("generated", "render-inputs.json")
    if not os.path.exists(path):
        raise SystemExit("missing %s: run `npx tsx scripts/build-render-inputs.ts`" % path)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if data.get("schema") != "render-inputs/1":
        raise SystemExit("unexpected render-inputs schema %r" % data.get("schema"))
    if verify:
        if content_hash(data) != data.get("hash"):
            raise SystemExit("render-inputs.json: content hash mismatch (file edited by hand?); rebuild it")
        mh = model_hash(repo_path())
        if mh != data.get("modelHash"):
            raise SystemExit("render-inputs.json is stale: model/*.json changed (rebuild: npx tsx scripts/build-render-inputs.ts)")
    return data
