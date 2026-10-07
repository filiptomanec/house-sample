"""Material palette of the furniture (light Scandinavian, see STYLE.md).

Interior materials are `f_*`, terrace materials `t_*`. Only the woods (WOOD) carry a texture; every other material is a
plain PBR colour. `SEM` maps semantic names to an (interior, terrace) pair so that one builder serves both.
"""
# name: (sRGB hex, roughness, metallic, alpha)
PALETTE = {
    'f_oak':         ('#DAC6A6', 0.55, 0.0, 1.0),    # light oak: frames, tops, fronts
    'f_oak_dark':    ('#8A6547', 0.55, 0.0, 1.0),    # accent wood: small parts, frames
    'f_white':       ('#EDEBE6', 0.42, 0.0, 1.0),    # matte white lacquer
    'f_greige':      ('#CFC6B8', 0.55, 0.0, 1.0),    # warm grey fronts
    'f_anthracite':  ('#34363A', 0.45, 0.3, 1.0),    # thin metal details
    'f_linen':       ('#F1EEE8', 0.92, 0.0, 1.0),    # bedding, linen
    'f_sand':        ('#D8CAB5', 0.95, 0.0, 1.0),    # throws, curtains, baskets
    'f_fabric_grey': ('#BEB8AF', 0.95, 0.0, 1.0),    # upholstery
    'f_sage':        ('#A4AF99', 0.95, 0.0, 1.0),    # muted accent textile
    'f_clay':        ('#C9A898', 0.85, 0.0, 1.0),    # dusty clay, small accents
    'f_blue':        ('#8C9DAC', 0.85, 0.0, 1.0),    # dusty blue-grey
    'f_ochre':       ('#D7C291', 0.85, 0.0, 1.0),    # soft ochre, one touch at most
    'f_ceramic':     ('#F5F5F3', 0.10, 0.0, 1.0),    # sanitary ware
    'f_chrome':      ('#D8D9DB', 0.15, 1.0, 1.0),    # taps, rails
    'f_black_metal': ('#1C1D1F', 0.40, 0.7, 1.0),    # lamps, profiles, hob
    'f_brass':       ('#C4A97A', 0.35, 1.0, 1.0),    # brushed brass, tiny accents
    'f_mirror':      ('#DCE1E4', 0.03, 1.0, 1.0),
    'f_glass':       ('#C9DADF', 0.05, 0.0, 0.22),   # shower screen, lamp glass
    'f_appliance':   ('#EFEFEE', 0.30, 0.0, 1.0),    # washer, fridge
    'f_steel':       ('#A9ABAE', 0.35, 0.9, 1.0),    # appliance panels, racks
    'f_screen':      ('#0F1011', 0.20, 0.0, 1.0),    # displays
    'f_stone':       ('#E3DFD7', 0.38, 0.0, 1.0),    # worktops
    'f_plant':       ('#4E6A38', 0.80, 0.0, 1.0),    # leaves
    'f_plant_olive': ('#7B8A63', 0.75, 0.0, 1.0),    # olive, eucalyptus
    'f_pot':         ('#E4DED4', 0.60, 0.0, 1.0),    # stoneware
    'f_rattan':      ('#D6C5A6', 0.80, 0.0, 1.0),    # baskets
    'f_paper':       ('#F3EFE6', 0.90, 0.0, 1.0),    # lamp shades, paper
    'f_leather':     ('#B79F82', 0.55, 0.0, 1.0),    # pulls, straps
    'f_rubber':      ('#222325', 0.85, 0.0, 1.0),    # tyres
    'f_car_paint_a': ('#D3D6D8', 0.30, 0.65, 1.0),   # silver-white metallic
    'f_car_paint_b': ('#4C5157', 0.30, 0.65, 1.0),   # graphite metallic
    'f_car_glass':   ('#202A30', 0.04, 0.0, 0.62),
    'f_car_light':   ('#F4F7F8', 0.10, 0.0, 1.0),
    'f_car_tail':    ('#7A2A2A', 0.20, 0.0, 1.0),
    'f_car_trim':    ('#25272A', 0.50, 0.3, 1.0),
    # terrace
    't_teak':        ('#C9AA86', 0.60, 0.0, 1.0),
    't_alu':         ('#3A3C3F', 0.40, 0.8, 1.0),    # powder-coated aluminium
    't_fabric':      ('#DCD3C4', 0.95, 0.0, 1.0),    # outdoor cushions
    't_sage':        ('#A9B39C', 0.95, 0.0, 1.0),
    't_pot':         ('#7D8082', 0.85, 0.0, 1.0),    # fibre-cement planters
    't_plant':       ('#4E6A38', 0.80, 0.0, 1.0),
    't_buxus':       ('#3F5B29', 0.80, 0.0, 1.0),
    't_grass':       ('#CDBF98', 0.85, 0.0, 1.0),    # dry ornamental grass
    't_lavender':    ('#8E8FB0', 0.85, 0.0, 1.0),
    't_enamel':      ('#0B0B0B', 0.18, 0.0, 1.0),    # kettle grill
    't_steel':       ('#9E9FA1', 0.30, 1.0, 1.0),
    't_glass':       ('#C9DADF', 0.05, 0.0, 0.25),   # lantern glass
    't_rope':        ('#CDBB93', 0.90, 0.0, 1.0),
    't_candle':      ('#F0EADB', 0.60, 0.0, 1.0),
    't_white':       ('#ECE9E2', 0.45, 0.0, 1.0),
}

WOOD = ('f_oak', 'f_oak_dark', 't_teak')

# semantic name -> (interior material, terrace material)
SEM = {
    'wood': ('f_oak', 't_teak'), 'wood_dark': ('f_oak_dark', 't_teak'),
    'fabric': ('f_linen', 't_fabric'), 'fabric2': ('f_sand', 't_fabric'), 'accent': ('f_sage', 't_sage'),
    'metal': ('f_anthracite', 't_alu'), 'steel': ('f_steel', 't_steel'), 'white': ('f_white', 't_white'),
    'plant': ('f_plant', 't_plant'), 'pot': ('f_pot', 't_pot'), 'glass': ('f_glass', 't_glass'),
    'rope': ('f_rattan', 't_rope'), 'candle': ('f_white', 't_candle'),
}


def srgb_to_linear(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# interior material -> terrace material, used when a piece stands on the terrace (the terrace uses t_* only)
OUTDOOR = {
    'f_oak': 't_teak', 'f_oak_dark': 't_teak', 'f_white': 't_white', 'f_greige': 't_fabric', 'f_anthracite': 't_alu',
    'f_linen': 't_fabric', 'f_sand': 't_fabric', 'f_fabric_grey': 't_fabric', 'f_sage': 't_sage', 'f_clay': 't_fabric',
    'f_blue': 't_fabric', 'f_ochre': 't_fabric', 'f_ceramic': 't_white', 'f_chrome': 't_steel', 'f_black_metal': 't_alu',
    'f_brass': 't_steel', 'f_mirror': 't_steel', 'f_glass': 't_glass', 'f_appliance': 't_white', 'f_steel': 't_steel',
    'f_screen': 't_enamel', 'f_stone': 't_white', 'f_plant': 't_plant', 'f_plant_olive': 't_plant', 'f_pot': 't_pot',
    'f_rattan': 't_rope', 'f_paper': 't_white', 'f_leather': 't_rope', 'f_rubber': 't_enamel', 'f_car_light': 't_candle',
}


def sem(name, outdoor):
    """Resolve a semantic material name (or pass a concrete palette name through; on the terrace f_* becomes t_*)."""
    if name in PALETTE:
        if outdoor and name.startswith('f_'):
            return OUTDOOR.get(name, 't_fabric')
        return name
    return SEM[name][1 if outdoor else 0]


def check(name):
    if name not in PALETTE:
        raise KeyError('material %r is not in the palette' % name)
    return name


def kind(name):
    return 'terrace' if name.startswith('t_') else 'interior'


def lum(name):
    r, g, b = srgb_to_linear(PALETTE[name][0])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


__all__ = ['PALETTE', 'WOOD', 'SEM', 'OUTDOOR', 'srgb_to_linear', 'sem', 'check', 'kind', 'lum']
