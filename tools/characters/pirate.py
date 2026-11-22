"""Parametric stylized pirate (y up, facing +Z, feet at 0), sculpted with sdf.py.

pirate(o) -> (Sculpt, joints). o is a dict of options (see DEFAULTS). Arms are modelled in an
A-pose (ARM_ANGLE from straight down) so skin weights separate cleanly; the game lowers them.
"""
import numpy as np
from sdf import Sculpt, Ellipsoid, Cone, Box, Fn, rot, hexrgb, fbm, vnoise

ARM_ANGLE = np.radians(38)

DEFAULTS = dict(
    female=False, height=1.0, bulk=1.0, belly=0.0, skin=0xd9a07a, eyes=0x4a6a8a,
    hair=0x3a2414, hair_style='short', beard=None, beard_color=None, brows=None, mustache=False,
    hat=None, hat_color=0x2a2420, trim=0xc8a040, bandana=None,
    coat=None, coat_len=0.62, cuffs=None, vest=None, shirt=0xe8dfc8, sleeves='long',
    sash=None, belt=0x3a2a1c, buckle=0xc8a040, pants=0x4a3c30, boots=0x3a2618, peg=False,
    nose=1.0, earring=False, patch=False, scar=False, age=0.0,
)

def mix(a, b, t):
    return a + (b - a) * t

def fabric(base, scale=60.0, amt=0.16, seed=0.0):
    c = hexrgb(base)
    def f(x, y, z):
        n = fbm(x * scale + seed, y * scale, z * scale, 3)
        return c * (1 - amt + amt * 2 * n)[..., None]
    return f

def folds(axis_pts, amp=0.0025, freq=55.0, seed=0.0):
    """Wrinkle displacement: ridges across a limb, broken up by noise."""
    a, b = np.array(axis_pts[0]), np.array(axis_pts[1])
    ax = (b - a) / np.linalg.norm(b - a)
    def d(x, y, z):
        t = (x - a[0]) * ax[0] + (y - a[1]) * ax[1] + (z - a[2]) * ax[2]
        n = vnoise(x * 25 + seed, y * 25, z * 25)
        return amp * np.sin(t * freq + n * 6.0) * (0.4 + n)
    return d

def cloth_noise(amp=0.0015, s=40.0):
    return lambda x, y, z: amp * (fbm(x * s, y * s, z * s, 2) - 0.5) * 2

def pirate(o):
    O = dict(DEFAULTS); O.update(o)
    S = Sculpt()
    H = O['height']; B = O['bulk']; F = O['female']
    skin = O['skin']
    sk0 = fabric(skin, 90, 0.06, 3.0)
    def sk(x, y, z, hy=None):
        c = sk0(x, y, z)
        hyy = 1.645 * O['height']
        rosy = np.exp(-((np.abs(x) - 0.05) ** 2 + (y - hyy + 0.03) ** 2) / 0.0006) + np.exp(-(x ** 2 + (y - hyy + 0.025) ** 2 + (z - 0.125) ** 2) / 0.0003)
        c = c * (1 - 0.18 * rosy[..., None]) + np.array([0.75, 0.3, 0.28]) * 0.18 * rosy[..., None]
        return c
    P = S.add

    # ---------- key points ----------
    hipY, kneeY, ankleY = 0.93 * H, 0.50 * H, 0.10
    waistY, chestY, shY = 1.08 * H, 1.29 * H, 1.44 * H
    neckY, headY = 1.51 * H, 1.645 * H
    hx = 0.095 * B * (1.08 if F else 1.0)
    shx = (0.175 if not F else 0.15) * B
    sh = np.array([shx, shY - 0.01, -0.005])
    dirA = np.array([np.sin(ARM_ANGLE), -np.cos(ARM_ANGLE), 0.06]); dirA /= np.linalg.norm(dirA)
    UA, FA = 0.29 * H, 0.255 * H
    def arm_pts(s):
        S0 = sh * np.array([s, 1, 1])
        d = dirA * np.array([s, 1, 1])
        el = S0 + d * UA
        d2 = d + np.array([0, 0, 0.12]); d2 /= np.linalg.norm(d2)
        wr = el + d2 * FA
        return S0, el, wr, d2

    shirt, pants, boots = O['shirt'], O['pants'], O['boots']
    coat = O['coat']; vest = O['vest']
    torso_col = coat or vest or shirt

    # front opening of a coat / vest: where the shirt (or skin) shows
    def opening(x, y, z):
        w = 0.025 + 0.06 * np.clip((y - (chestY - 0.12)) / 0.25, 0, 1)
        return (z > 0) & (np.abs(x) < w)
    def torso_colour(x, y, z):
        base = fabric(torso_col, 70, 0.14)(x, y, z)
        if coat or vest:
            inner = fabric(shirt, 80, 0.1, 5.0)(x, y, z)
            m = opening(x, y, z)[..., None]
            base = np.where(m, inner, base)
            if O['trim'] and coat:
                w = 0.025 + 0.06 * np.clip((y - (chestY - 0.12)) / 0.25, 0, 1)
                edge = ((z > 0) & (np.abs(np.abs(x) - w) < 0.009))[..., None]
                base = np.where(edge, hexrgb(O['trim']) * (0.85 + 0.15 * fbm(x * 200, y * 200, z * 200, 2))[..., None], base)
        # open neck: skin in a V
        v = (z > 0.02) & (y > shY - 0.13) & (np.abs(x) < 0.04 * np.clip((y - (shY - 0.13)) / 0.1, 0, 1.2))
        return np.where(v[..., None], sk(x, y, z), base)

    # ---------- torso ----------
    chest_r = np.array([0.165 * B, 0.16, 0.112 * B]) if not F else np.array([0.14 * B, 0.15, 0.10 * B])
    P(Ellipsoid((0, chestY, -0.005), chest_r, color=torso_colour, k=0.05, disp=cloth_noise()))
    belly = O['belly']
    if F:
        for sx in (-1, 1):
            P(Ellipsoid((sx * 0.058, chestY + 0.0, 0.07), (0.062, 0.06, 0.058), color=torso_colour, k=0.04, disp=cloth_noise()))
    P(Ellipsoid((0, waistY + 0.02, 0.01 + belly * 0.04), ((0.125 if F else 0.15) * B + belly * 0.04, 0.13, (0.095 if F else 0.11) * B + belly * 0.06), color=torso_colour, k=0.06, disp=cloth_noise()))
    P(Ellipsoid((0, hipY + 0.04, -0.01 if F else -0.005), (0.15 * B * (1.12 if F else 1), 0.1, (0.115 if F else 0.105) * B), color=fabric(pants, 70), k=0.05))
    for s in (-1, 1):
        P(Ellipsoid((s * (shx - 0.02), shY - 0.03, -0.01), (0.062 * B, 0.052, 0.064), color=torso_colour, k=0.05))
    # belt / sash at the waist
    if O['sash']:
        P(Fn(lambda x, y, z: np.maximum(np.abs(y - (hipY + 0.11)) - 0.035, -1), (-0.3, hipY + 0.07, -0.2), (0.3, hipY + 0.15, 0.2), op='paint', color=fabric(O['sash'], 90, 0.2), ck=0.004))
    if O['belt']:
        by = hipY + 0.085
        P(Fn(lambda x, y, z, by=by: np.abs(y - by) - 0.022, (-0.3, by - 0.03, -0.2), (0.3, by + 0.03, 0.2), op='paint', color=fabric(O['belt'], 120, 0.12), ck=0.002))
        P(Box((0, by, 0.12 * B + belly * 0.05), (0.03, 0.026, 0.008), rr=0.004, color=O['buckle'], k=0.004))
    # neck
    P(Cone((0, shY - 0.04, -0.01), (0, neckY + 0.06, 0.005), 0.058, 0.05, color=sk, k=0.03))

    # ---------- coat skirt ----------
    if coat:
        top, bot = waistY - 0.02, waistY - O['coat_len'] * H * 0.55 - 0.12
        def skirt(x, y, z, top=top, bot=bot):
            t = np.clip((top - y) / (top - bot), 0, 1)
            r = 0.155 * B + belly * 0.03 + t * 0.09 + 0.02 * t * np.clip(-z / 0.15, 0, 1)
            rr = np.sqrt(x * x + (z * 1.25) ** 2)
            d = np.maximum(rr - r, np.maximum(y - top, bot - y))
            # hollow (shell 1.5 cm) and split at the front
            d = np.maximum(d, (r - 0.015) - rr)
            d = np.maximum(d, -(np.abs(x) - (0.02 + t * 0.07)) if True else d) if False else d
            front = (z > 0) & (np.abs(x) < 0.025 + t * 0.08)
            return np.where(front, np.maximum(d, 0.02), d)
        P(Fn(skirt, (-0.3, bot, -0.25), (0.3, top, 0.25), color=fabric(coat, 70, 0.14), k=0.01, disp=folds(((0, 0, 0), (1, 0, 0.2)), 0.003, 70)))
        # turned-down collar round the back of the neck
        def collar(x, y, z):
            d = Ellipsoid((0, shY + 0.0, -0.02), (0.1, 0.05, 0.09))._d(x, y, z)
            d = np.maximum(d, -Ellipsoid((0, shY + 0.02, -0.01), (0.075, 0.09, 0.07))._d(x, y, z))
            return np.maximum(d, np.where(z > 0.03, 0.02 + 0 * d, d))
        P(Fn(collar, (-0.15, shY - 0.08, -0.13), (0.15, shY + 0.08, 0.12), color=fabric(O['cuffs'] or coat, 70, 0.12), k=0.012))
        # buttons down the front
        for i in range(4):
            y = chestY + 0.06 - i * 0.07
            for s in (-1, 1):
                P(Ellipsoid((s * 0.065, y, 0.11 * B + (belly * 0.04 if y < chestY - 0.1 else 0)), (0.009, 0.009, 0.006), color=O['trim'] or 0xc8a040, k=0.003))

    # ---------- arms ----------
    sleeve = coat or (shirt if O['sleeves'] != 'none' else None)
    for s in (-1, 1):
        S0, el, wr, d2 = arm_pts(s)
        ua_col = fabric(sleeve, 80, 0.14) if sleeve else sk
        P(Cone(S0, el, 0.056 * B, 0.044 * B, color=ua_col, k=0.03, disp=folds((S0, el), 0.003, 60, s) if sleeve else None))
        if O['sleeves'] == 'rolled' and not coat:
            fa_col = sk
            P(Ellipsoid(el + (wr - el) * 0.08, (0.05 * B, 0.05 * B, 0.05 * B), color=fabric(sleeve, 80), k=0.015))
        else:
            fa_col = ua_col
        P(Cone(el, wr, 0.044 * B ** 1.5, 0.033 * B ** 1.5, color=fa_col, k=0.02, disp=folds((el, wr), 0.0025, 60, s + 3) if fa_col is not sk else None))
        if coat and (O['cuffs'] or O['trim']):
            P(Cone(wr - d2 * 0.07, wr - d2 * 0.005, 0.047, 0.044, color=fabric(O['cuffs'] or coat, 80), k=0.008))
        # hand: palm and fingers, gently curled
        side = np.cross(d2, np.array([0, 0, 1.0])); side /= np.linalg.norm(side)
        fwd = np.cross(side, d2)
        palm = wr + d2 * 0.05
        P(Ellipsoid(palm, (0.04, 0.05, 0.018), R=_frame(side, d2, fwd), color=sk, k=0.015))
        for i, off in enumerate((-0.024, -0.008, 0.008, 0.024)):
            base = palm + d2 * 0.04 + side * off * s
            L = 0.055 - abs(i - 1.5) * 0.006
            mid = base + d2 * L * 0.55 + fwd * 0.012
            tip = mid + d2 * L * 0.35 + fwd * 0.022
            P(Cone(base, mid, 0.0095, 0.0085, color=sk, k=0.006))
            P(Cone(mid, tip, 0.0085, 0.0075, color=sk, k=0.005))
        tb = palm + side * 0.03 * s + fwd * 0.01
        P(Cone(tb, tb + d2 * 0.035 + fwd * 0.03 + side * 0.01 * s, 0.011, 0.009, color=sk, k=0.008))
        if O['earring'] and s == 1:
            pass

    # ---------- legs ----------
    for s in (-1, 1):
        hip = np.array([s * hx, hipY, 0]); knee = np.array([s * hx * 1.02, kneeY, 0.012]); ank = np.array([s * hx * 1.02, ankleY, -0.005])
        P(Cone(hip, knee, 0.078 * B * (1.08 if F else 1), 0.054, color=fabric(pants, 70), k=0.04, disp=folds((hip, knee), 0.003, 50, s + 7)))
        if O['peg'] and s == -1:
            P(Cone(knee, knee + np.array([0, -0.12, 0]), 0.054, 0.045, color=fabric(pants, 70), k=0.02))
            P(Cone(knee + np.array([0, -0.11, 0]), np.array([s * hx, 0.01, 0.0]), 0.03, 0.022, color=fabric(0x6a4a2a, 30, 0.25), k=0.01))
            P(Cone(knee + np.array([0, -0.13, 0]), knee + np.array([0, -0.1, 0]), 0.042, 0.042, color=0x3a2a1a, k=0.005))
            continue
        P(Cone(knee, ank, 0.05, 0.036, color=fabric(pants, 70), k=0.02))
        # boot: shaft, cuff, foot and sole
        bt = fabric(boots, 50, 0.12, 11.0)
        top = kneeY - 0.05
        P(Cone((s * hx * 1.02, top, 0.006), ank + np.array([0, -0.02, 0]), 0.058, 0.046, color=bt, k=0.012, disp=folds(((0, top, 0), (0, 0, 0)), 0.002, 80)))
        P(Cone((s * hx * 1.02, top + 0.035, 0.006), (s * hx * 1.02, top - 0.03, 0.006), 0.068, 0.062, color=bt, k=0.008))
        P(Ellipsoid((s * hx * 1.02, 0.05, 0.045), (0.048, 0.045, 0.115), color=bt, k=0.03))
        P(Box((s * hx * 1.02, 0.012, 0.045), (0.05, 0.012, 0.12), rr=0.01, color=0x1e140c, k=0.006))

    # ---------- head ----------
    hy = headY
    P(Ellipsoid((0, hy + 0.02, -0.005), (0.099, 0.112, 0.106), color=sk, k=0.03))                  # cranium
    P(Ellipsoid((0, hy - 0.055, 0.022), (0.088 if not F else 0.074, 0.064, 0.084), color=sk, k=0.04))  # jaw / cheeks
    P(Ellipsoid((0, hy + 0.038, 0.083), (0.074, 0.022, 0.03), color=sk, k=0.02))                  # brow ridge
    for s in (-1, 1):
        P(Ellipsoid((s * 0.045, hy - 0.02, 0.07), (0.03, 0.025, 0.03), color=sk, k=0.025))           # cheekbones
        P(Ellipsoid((s * 0.038, hy + 0.013, 0.1), (0.022, 0.017, 0.016), op='sub', color=None, k=0.008))  # sockets
        ec = np.array([s * 0.038, hy + 0.012, 0.087])
        P(Ellipsoid(ec, (0.0172, 0.0172, 0.0172), color=_eye(ec, O['eyes']), k=0.002, ck=0.0005))
        # upper and lower lids
        P(Ellipsoid(ec + np.array([0, 0.0132, 0.001]), (0.0192, 0.0072, 0.0172), R=rot(0.35, 0, 0), color=sk, k=0.003, ck=0.001))
        P(Ellipsoid(ec + np.array([0, -0.0148, 0.001]), (0.018, 0.0055, 0.016), R=rot(-0.2, 0, 0), color=sk, k=0.003, ck=0.001))
        if F:
            P(Ellipsoid(ec + np.array([0, 0.0118, 0.0045]), (0.019, 0.0048, 0.0155), R=rot(0.35, 0, s * 0.12), color=0x1a1210, k=0.002, ck=0.0006))
        # ears
        P(Ellipsoid((s * 0.096, hy + 0.005, -0.006), (0.012, 0.03, 0.019), R=rot(0, s * 0.35, 0), color=sk, k=0.012))
    # nose
    n = O['nose']
    P(Cone((0, hy + 0.025, 0.103), (0, hy - 0.022, 0.122 + 0.006 * n), 0.009, 0.013 * n, color=sk, k=0.012))
    P(Ellipsoid((0, hy - 0.026, 0.121 + 0.006 * n), (0.016 * n, 0.014 * n, 0.014 * n), color=sk, k=0.01))
    for s in (-1, 1):
        P(Ellipsoid((s * 0.013, hy - 0.031, 0.112), (0.011, 0.009, 0.01), color=sk, k=0.008))
    # mouth and lips
    my = hy - 0.058
    P(Ellipsoid((0, my + 0.006, 0.108), (0.022, 0.006, 0.01), color=_lip(skin), k=0.006, ck=0.002))
    P(Ellipsoid((0, my - 0.007, 0.105), (0.019, 0.0065, 0.01), color=_lip(skin), k=0.006, ck=0.002))
    P(Ellipsoid((0, my, 0.116), (0.018, 0.0012, 0.01), op='sub', color=0x3a1414, k=0.002, ck=0.001))
    P(Ellipsoid((0, hy - 0.09, 0.09), (0.03, 0.022, 0.025), color=sk, k=0.02))                    # chin

    # brows
    bc = O['brows'] if O['brows'] is not None else (O['beard_color'] or O['hair'])
    for s in (-1, 1):
        a = np.array([s * 0.014, hy + 0.038, 0.106]); b = np.array([s * 0.062, hy + 0.042 + (0.002 if not F else 0.007), 0.088])
        P(Cone(a + np.array([0, 0, 0.004]), b + np.array([0, 0, 0.004]), 0.0105 if not F else 0.0045, 0.0068 if not F else 0.0028, color=_hairc(bc, 400), k=0.003, ck=0.001, disp=_strands(0.0012, 600)))

    # hair
    hc = O['hair']
    if O['hair_style'] != 'bald':
        def hairshell(x, y, z):
            return Ellipsoid((0, hy + 0.025, -0.012), (0.1, 0.118, 0.108))._d(x, y, z)
        def hairmask(x, y, z):
            d = hairshell(x, y, z)
            # leave the face clear
            face = (z > 0.02) & (y < hy + 0.06)
            ears = (np.abs(x) > 0.085) & (y < hy + 0.03) & (y > hy - 0.03) & (z > -0.03)
            return np.where(face | ears, np.maximum(d, 0.01), d)
        P(Fn(hairmask, (-0.13, hy - 0.1, -0.14), (0.13, hy + 0.15, 0.12), color=_hairc(hc, 300), k=0.006, ck=0.002, disp=_strands(0.002, 500)))
        if O['hair_style'] == 'long':
            P(Ellipsoid((0, hy - 0.07, -0.07), (0.085, 0.1, 0.045), color=_hairc(hc, 300), k=0.03, disp=_strands(0.003, 400)))
        if O['hair_style'] in ('braid', 'twinbraids'):
            # a thick plait from behind the right ear, over the shoulder and down the front
            # (twinbraids: one each side)
            for sx in ((1, -1) if O['hair_style'] == 'twinbraids' else (1,)):
                pts = [(-0.075 * sx, hy - 0.02, -0.04), (-0.1 * sx, hy - 0.1, 0.0), (-0.11 * sx, hy - 0.17, 0.05), (-0.1 * sx, hy - 0.25, 0.08), (-0.09 * sx, hy - 0.33, 0.09), (-0.085 * sx, hy - 0.4, 0.09)]
                for i in range(len(pts) - 1):
                    a, b = np.array(pts[i]), np.array(pts[i + 1])
                    for kk in range(3):
                        c = a + (b - a) * (kk + 0.5) / 3
                        P(Ellipsoid(c, (0.024 - i * 0.002, 0.03, 0.022 - i * 0.002), color=_hairc(hc, 300), k=0.006, disp=_strands(0.0015, 600)))
                P(Ellipsoid((-0.085 * sx, hy - 0.41, 0.09), (0.014, 0.012, 0.014), color=O['trim'] or 0xa82020, k=0.004))
        if O['hair_style'] == 'ponytail':
            P(Cone((0, hy, -0.11), (0, hy - 0.17, -0.12), 0.03, 0.018, color=_hairc(hc, 300), k=0.02, disp=_strands(0.002, 500)))

    # beard / moustache
    if O['beard']:
        bcol = O['beard_color'] or hc
        size = {'full': 1.0, 'big': 1.25, 'goatee': 0.55, 'stubble': 0}[O['beard']]
        if size:
            def beard(x, y, z, size=size):
                c = (0, hy - 0.075 - 0.02 * size, 0.055)
                d = Ellipsoid(c, (0.08 * min(1, size + 0.3), 0.06 + 0.035 * size, 0.07))._d(x, y, z)
                # only below the cheekbones and in front of the ears
                d = np.maximum(d, (hy - 0.025) - (hy - 0.025 + (y - (hy - 0.025))) if False else d)
                d = np.maximum(d, y - (hy - 0.03 + 0.02 * (np.abs(x) / 0.08)))
                d = np.maximum(d, -z - 0.0)
                return d
            P(Fn(beard, (-0.11, hy - 0.22, -0.02), (0.11, hy, 0.17), color=_hairc(bcol, 250), k=0.02, ck=0.004, disp=_strands(0.0035, 300)))
            P(Ellipsoid((0, my, 0.125), (0.02, 0.004, 0.03), op='sub', color=0x3a1414, k=0.004))
        if O['mustache'] or size:
            for s in (-1, 1):
                P(Cone((s * 0.004, hy - 0.043, 0.124), (s * 0.048, hy - 0.072, 0.104), 0.012, 0.006, color=_hairc(bcol, 300), k=0.006, ck=0.002, disp=_strands(0.0015, 500)))
        if O['beard'] == 'stubble':
            P(Fn(lambda x, y, z: np.maximum(y - (hy - 0.035), -z), (-0.11, hy - 0.13, 0.0), (0.11, hy - 0.03, 0.15), op='paint',
                 color=lambda x, y, z: (sk(x, y, z) * 0.55 + hexrgb(bcol) * 0.45 * (vnoise(x * 900, y * 900, z * 900) > 0.45)[..., None] + sk(x, y, z) * 0.45 * (vnoise(x * 900, y * 900, z * 900) <= 0.45)[..., None]), ck=0.004))

    # eye patch
    if O['patch']:
        P(Ellipsoid((0.036, hy + 0.012, 0.1), (0.022, 0.019, 0.01), color=0x141210, k=0.004))
        P(Fn(lambda x, y, z: np.abs(Ellipsoid((0, hy + 0.03, -0.01), (0.106, 0.118, 0.11))._d(x, y, z)) - 0.002 + 0 * x
             if False else np.maximum(np.abs(Ellipsoid((0, hy + 0.03, -0.01), (0.104, 0.116, 0.108))._d(x, y, z)) - 0.003, np.abs((y - hy - 0.03) - 0.35 * x) - 0.005),
             (-0.13, hy - 0.06, -0.13), (0.13, hy + 0.12, 0.13), color=0x141210, k=0.002))

    # ---------- headwear ----------
    if O['hat'] == 'tricorn':
        _tricorn(P, hy, O['hat_color'], O['trim'])
    elif O['bandana']:
        bcol = O['bandana']
        def band(x, y, z):
            d = Ellipsoid((0, hy + 0.032, -0.01), (0.103, 0.12, 0.112))._d(x, y, z)
            return np.maximum(d, (hy + 0.03) - y + 0.02 * z / 0.1)
        P(Fn(band, (-0.14, hy - 0.02, -0.14), (0.14, hy + 0.17, 0.14), color=fabric(bcol, 120, 0.2), k=0.008, ck=0.002, disp=folds(((0, 0, 0), (0, 1, 0.3)), 0.0015, 120)))
        P(Ellipsoid((-0.03, hy + 0.02, -0.115), (0.035, 0.025, 0.02), color=fabric(bcol, 120, 0.2), k=0.01))
        P(Cone((-0.03, hy + 0.01, -0.12), (-0.06, hy - 0.08, -0.14), 0.016, 0.01, color=fabric(bcol, 120, 0.2), k=0.008))
        P(Cone((-0.025, hy + 0.01, -0.12), (0.0, hy - 0.06, -0.15), 0.014, 0.008, color=fabric(bcol, 120, 0.2), k=0.008))

    # ---------- rig ----------
    J = {}
    J['hips'] = ((0, hipY + 0.03, 0), (0, waistY, 0), None)
    J['spine'] = ((0, waistY, 0), (0, chestY - 0.02, 0), 'hips')
    J['chest'] = ((0, chestY - 0.02, 0), (0, shY + 0.02, 0), 'spine')
    J['neck'] = ((0, shY + 0.02, 0), (0, neckY + 0.05, 0.005), 'chest')
    J['head'] = ((0, neckY + 0.05, 0.005), (0, hy + 0.14, 0.0), 'neck')
    for s, L in ((1, 'L'), (-1, 'R')):
        S0, el, wr, d2 = arm_pts(s)
        J[f'shoulder.{L}'] = ((s * 0.03, shY - 0.01, -0.005), tuple(S0), 'chest')
        J[f'upperarm.{L}'] = (tuple(S0), tuple(el), f'shoulder.{L}')
        J[f'forearm.{L}'] = (tuple(el), tuple(wr), f'upperarm.{L}')
        J[f'hand.{L}'] = (tuple(wr), tuple(wr + d2 * 0.13), f'forearm.{L}')
        J[f'thigh.{L}'] = ((s * hx, hipY, 0), (s * hx * 1.02, kneeY, 0.012), 'hips')
        J[f'shin.{L}'] = ((s * hx * 1.02, kneeY, 0.012), (s * hx * 1.02, ankleY, -0.005), f'thigh.{L}')
        J[f'foot.{L}'] = ((s * hx * 1.02, ankleY, -0.005), (s * hx * 1.02, 0.02, 0.13), f'shin.{L}')
    return S, J

def _frame(xa, ya, za):
    return np.stack([xa, ya, za], axis=1)

def _eye(ec, iris):
    ic = hexrgb(iris)
    def f(x, y, z):
        d = np.stack([x - ec[0], y - ec[1], z - ec[2]], -1)
        d = d / np.maximum(np.linalg.norm(d, axis=-1, keepdims=True), 1e-6)
        # looking forward and a touch inward
        a = np.clip(d[..., 2] * 0.995 - d[..., 0] * np.sign(ec[0]) * 0.1, -1, 1)
        ang = np.arccos(a)
        w = np.array([0.93, 0.9, 0.86])
        col = np.where((ang < 0.52)[..., None], ic * (0.7 + 0.5 * (ang / 0.52))[..., None], w)
        col = np.where((ang < 0.22)[..., None], np.array([0.03, 0.025, 0.02]), col)
        col = np.where(((ang > 0.5) & (ang < 0.56))[..., None], ic * 0.35, col)
        return col
    return f

def _lip(skin):
    c = hexrgb(skin) * np.array([0.82, 0.6, 0.58])
    return tuple(c)

def _hairc(c, s):
    base = hexrgb(c)
    def f(x, y, z):
        n = vnoise(x * s, y * s * 0.25, z * s)
        return base * (0.7 + 0.55 * n)[..., None]
    return f

def _strands(amp, s):
    return lambda x, y, z: amp * (vnoise(x * s, y * s * 0.15, z * s) - 0.5) * 2

def _tricorn(P, hy, col, trim):
    c = fabric(col, 80, 0.12)
    cy = hy + 0.085
    P(Ellipsoid((0, cy + 0.04, -0.01), (0.108, 0.075, 0.118), color=c, k=0.01, disp=cloth_noise(0.001)))
    def brim(x, y, z):
        r = np.sqrt(x * x + (z + 0.01) ** 2)
        ph = np.arctan2(x, z + 0.01)
        R = 0.2
        t = np.clip((r - 0.09) / (R - 0.09), 0, 1)
        lift = (0.5 + 0.5 * np.cos(3 * ph)) * 0.085 * t ** 1.4 + 0.01 * t
        yb = cy + 0.005 + lift
        d = np.abs(y - yb) - 0.0075
        return np.maximum(d, r - (R - 0.02 * (0.5 - 0.5 * np.cos(3 * ph))))
    def brim_col(x, y, z):
        r = np.sqrt(x * x + (z + 0.01) ** 2); ph = np.arctan2(x, z + 0.01)
        R = 0.2 - 0.02 * (0.5 - 0.5 * np.cos(3 * ph))
        base = c(x, y, z)
        if trim:
            base = np.where((r > R - 0.012)[..., None], hexrgb(trim) * (0.8 + 0.2 * fbm(x * 300, y * 300, z * 300, 2))[..., None], base)
        return base
    P(Fn(brim, (-0.22, cy - 0.02, -0.23), (0.22, cy + 0.12, 0.21), color=brim_col, k=0.012, ck=0.002))
