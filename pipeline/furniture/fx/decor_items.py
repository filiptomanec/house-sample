"""Registry of decor items: name -> builder and metadata used by the rule engine.

place: floor (free floor area), surface (on an anchor of a piece), wall (hung on a wall at y = 0, face to -y),
       ceiling (hangs from the ceiling), rug (flat, under furniture groups).
r: footprint radius (m) used for spacing and collisions; h: height (m); size: (w, d) for rectangular items.
"""
from . import plants as P, props as R, textiles as T, stuff as S


def _books(pc, n=3, **kw):
    S.book_stack(pc, 0, 0, 0, n=n)


def _books_row(pc, w=0.4, **kw):
    S.books(pc, -w / 2, w / 2, 0, 0, hmax=0.24, depth=0.15)


def _baskets(pc, r=0.16, **kw):
    S.basket(pc, 0, 0, 0, r=r, h=0.28, content=pc.pick(['f_linen', 'f_sand', 'f_sage']))


def _crates(pc, n=3, **kw):
    for i in range(n):
        S.crate(pc, 0.0, 0.0, i * 0.22, w=0.4, d=0.3, h=0.22, mat=pc.pick(['f_greige', 'f_fabric_grey', 'f_sand']))


def _bucket(pc, **kw):
    pc.cyl(0, 0, 0, 0.26, 0.15, 'f_steel', seg=pc.n(16, 8), rad1=0.18)
    pc.tube((-0.15, 0, 0.26), (0.0, 0, 0.36), 0.004, 'f_anthracite', seg=4)
    pc.tube((0.0, 0, 0.36), (0.15, 0, 0.26), 0.004, 'f_anthracite', seg=4)


ITEMS = {
    # plants
    'monstera': dict(fn=P.monstera, place='floor', r=0.42, h=1.05),
    'fig': dict(fn=P.fig, place='floor', r=0.30, h=1.5),
    'olive': dict(fn=P.olive, place='floor', r=0.36, h=1.75),
    'snake_plant': dict(fn=P.snake_plant, place='floor', r=0.16, h=0.7),
    'pampas': dict(fn=P.pampas, place='floor', r=0.22, h=1.2),
    'buxus': dict(fn=P.buxus, place='floor', r=0.2, h=0.65),
    'pothos': dict(fn=P.pothos, place='surface', r=0.12, h=0.2),
    'succulent': dict(fn=P.succulent, place='surface', r=0.08, h=0.14),
    'eucalyptus': dict(fn=P.eucalyptus, place='surface', r=0.12, h=0.6),
    # objects
    'vase': dict(fn=R.vase, place='surface', r=0.07, h=0.26),
    'bowl': dict(fn=R.bowl, place='surface', r=0.14, h=0.08),
    'fruit_bowl': dict(fn=lambda pc, **kw: R.bowl(pc, fruit='lemon', **kw), place='surface', r=0.14, h=0.12),
    'tray': dict(fn=R.tray, place='surface', r=0.22, h=0.16, size=(0.42, 0.28)),
    'candles': dict(fn=R.candles, place='surface', r=0.1, h=0.16),
    'books': dict(fn=_books, place='surface', r=0.12, h=0.1),
    'books_row': dict(fn=_books_row, place='surface', r=0.2, h=0.25),
    'table_lamp': dict(fn=R.lamp_table, place='surface', r=0.16, h=0.5),
    'desk_lamp': dict(fn=R.lamp_desk, place='surface', r=0.12, h=0.45),
    'laptop': dict(fn=R.laptop, place='surface', r=0.2, h=0.23),
    'cutting_board': dict(fn=R.cutting_board, place='surface', r=0.16, h=0.07, size=(0.32, 0.2)),
    'jug': dict(fn=R.jug, place='surface', r=0.06, h=0.24),
    'lantern': dict(fn=R.lantern, place='surface', r=0.1, h=0.34),
    'soap_set': dict(fn=R.soap_set, place='surface', r=0.095, h=0.2),
    'cosmetics': dict(fn=R.cosmetics, place='surface', r=0.1, h=0.15),
    'towel_stack': dict(fn=R.towel_stack, place='surface', r=0.15, h=0.15),
    'teddy': dict(fn=R.teddy, place='surface', r=0.1, h=0.28),
    'blocks': dict(fn=R.blocks, place='surface', r=0.1, h=0.1),
    'toy_car': dict(fn=R.toy_car, place='surface', r=0.08, h=0.08),
    'baskets': dict(fn=_baskets, place='floor', r=0.18, h=0.3),
    'laundry_basket': dict(fn=R.laundry_basket, place='floor', r=0.22, h=0.55),
    'floor_lamp': dict(fn=R.floor_lamp, place='floor', r=0.22, h=1.65),
    'pendant': dict(fn=R.pendant, place='ceiling', r=0.28, h=0.9),
    'wheelbarrow': dict(fn=R.wheelbarrow, place='floor', r=0.5, h=0.55, size=(1.3, 0.55)),
    'stepladder': dict(fn=R.stepladder, place='floor', r=0.3, h=1.5, size=(0.45, 0.32)),
    'crates': dict(fn=_crates, place='floor', r=0.3, h=0.66, size=(0.42, 0.32)),
    'bucket': dict(fn=_bucket, place='floor', r=0.18, h=0.36),
    'shoes': dict(fn=R.shoes, place='surface', r=0.14, h=0.08),
    'planter_box': dict(fn=R.planter_box, place='floor', r=0.4, h=0.7, size=(0.8, 0.26)),
    'grass_tuft': dict(fn=P.grass_tuft, place='floor', r=0.2, h=0.6),
    # wall hung
    'frame': dict(fn=R.frame, place='wall', r=0.3, h=0.7),
    'wall_shelf': dict(fn=R.wall_shelf, place='wall', r=0.45, h=0.3, size=(0.9, 0.2)),
    'tool_rack': dict(fn=R.tool_rack, place='wall', r=0.5, h=1.5, size=(1.0, 0.1)),
    'towel_hung': dict(fn=R.towel_hung, place='wall', r=0.25, h=0.9),
    # textiles
    'rug': dict(fn=T.rug, place='rug', r=1.0, h=0.02),
    'sheepskin': dict(fn=T.sheepskin, place='surface', r=0.3, h=0.08),
    'throw': dict(fn=T.throw_folded, place='surface', r=0.4, h=0.07),
    'curtain_set': dict(fn=T.curtain_set, place='opening', r=1.0, h=2.6),
}
