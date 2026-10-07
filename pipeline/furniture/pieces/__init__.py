"""Piece builders: one function per catalog builder name, `fn(pc, w, d, variant)` drawing into a `Piece`.

Local frame: origin at the footprint centre on the floor, +x width, +y back (wall side at rot 0), +z up.
"""
import importlib
from fx.piece import Piece

BUILDERS = {}


def builder(name):
    def deco(fn):
        BUILDERS[name] = fn
        return fn
    return deco


_MODULES = ['beds', 'seating', 'chairs', 'tables', 'kitchen', 'cabinets', 'wet', 'outdoor', 'car']


def load():
    for m in _MODULES:
        importlib.import_module('.' + m, __name__)


def build(builder_name, w, d, variant=None, hi=True, outdoor=False, seed=0, ctx=None, params=None):
    load()
    pc = Piece(builder_name, hi=hi, outdoor=outdoor, seed=seed, ctx=ctx, params=params)
    pc.w, pc.d, pc.variant = w, d, variant
    BUILDERS[builder_name](pc, w, d, variant)
    return pc
