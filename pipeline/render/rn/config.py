"""Render configuration: config.json (quality presets, Cycles and look settings) with environment overrides."""
from __future__ import annotations

import json
import os

from .util import RENDER_DIR


class Config:
    def __init__(self, data, quality):
        self.d = data
        if os.environ.get("RENDER_SKY"):                      # experiments: RENDER_SKY=0.3 overrides look.skyStrength
            data["look"]["skyStrength"] = float(os.environ["RENDER_SKY"])
        if os.environ.get("RENDER_TREE_COPIES"):
            n = int(os.environ["RENDER_TREE_COPIES"])
            for k in data["trees"]["copies"]:
                data["trees"]["copies"][k] = n
        if os.environ.get("RENDER_EXPOSURE"):
            data["look"]["exposure"] = float(os.environ["RENDER_EXPOSURE"])
        if os.environ.get("RENDER_LOOK"):                     # calibration: RENDER_LOOK='{"bounceSaturation": 0.2}'
            for k, v in json.loads(os.environ["RENDER_LOOK"]).items():
                if isinstance(v, dict) and isinstance(data["look"].get(k), dict):
                    data["look"][k].update(v)
                else:
                    data["look"][k] = v
        if quality not in data["quality"]:
            raise SystemExit("quality must be one of %s" % ", ".join(data["quality"]))
        self.quality = quality
        self.q = data["quality"][quality]

    @staticmethod
    def load(quality="draft", path=None):
        with open(path or os.path.join(RENDER_DIR, "config.json"), "r", encoding="utf-8") as f:
            return Config(json.load(f), quality)

    def __getitem__(self, k):
        return self.d[k]

    def mode(self, mode):
        """Preset of a mode (stills | day | orbit) with RENDER_SAMPLES applied."""
        m = dict(self.q[mode])
        env = os.environ.get("RENDER_SAMPLES")
        if env:
            m["samples"] = int(env)
        return m

    def size(self, mode, base, portrait=False):
        m = self.q[mode]
        s = m.get("portraitScale", m["scale"]) if portrait else m["scale"]
        return (max(2, int(round(base[0] * s / 2.0)) * 2), max(2, int(round(base[1] * s / 2.0)) * 2))
