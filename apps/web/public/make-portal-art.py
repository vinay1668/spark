#!/usr/bin/env python3
"""Generate identity-portal.png — polished pixel-art Nether portal scene.

Output is a 1:2 portrait (400x800 px) sized for the identity dialog's left
art panel. Logical canvas is 100x200 cells, scaled 4x with nearest-neighbor
to preserve crisp block edges.
"""
from PIL import Image
import random, math

random.seed(20261106)

LW, LH = 100, 200
SCALE = 4
W, H = LW * SCALE, LH * SCALE

img = Image.new("RGBA", (LW, LH), (0, 0, 0, 255))

def put(x, y, c):
    if 0 <= x < LW and 0 <= y < LH:
        img.putpixel((x, y), c)

def blend(x, y, c, k):
    if 0 <= x < LW and 0 <= y < LH:
        b = img.getpixel((x, y))
        put(x, y, tuple(int(b[i] * (1 - k) + c[i] * k) for i in range(3)) + (255,))

def hex_to_rgb(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))

def noise(x, y, seed):
    return (math.sin(x * 0.23 + seed) + math.cos(y * 0.31 + seed * 1.7) + math.sin((x + y) * 0.13 + seed * 2.9)) / 3

def smooth_noise(x, y, seed):
    return (math.sin(x * 0.11 + seed) + math.cos(y * 0.09 + seed * 2.1) + math.sin((x - y) * 0.07 + seed)) / 3

# ── palette ──
SKY_TOP    = (86, 150, 218)
SKY_MID    = (132, 188, 238)
SKY_HOR    = (186, 218, 248)
CLOUD      = (255, 255, 255)
CLOUD_SHAD = (232, 242, 248)
TREE_DARK  = (38, 84, 34)
TREE_MID   = (52, 112, 45)
TREE_LIGHT = (70, 142, 60)
TRUNK      = (74, 54, 38)
GRASS_A    = (120, 188, 80)
GRASS_B    = (108, 172, 72)
GRASS_C    = (126, 196, 86)
GRASS_D    = (96, 156, 62)
GRASS_DARK = (78, 132, 52)
FLOWER_Y   = (250, 220, 78)
FLOWER_W   = (255, 255, 255)
FLOWER_CTR = (255, 248, 220)
OBS_DARK   = (24, 13, 36)
OBS_MID    = (33, 19, 50)
OBS_LIGHT  = (44, 27, 66)
OBS_HIGH   = (64, 43, 98)
PORTAL_DEEP= (48, 20, 86)
PORTAL_MID = (118, 62, 188)
PORTAL_LIT = (210, 158, 255)
GLOW       = (158, 108, 238)

HORIZON = 96

# ── sky gradient ──
for y in range(HORIZON):
    t = y / HORIZON
    r = int(SKY_TOP[0] + (SKY_HOR[0] - SKY_TOP[0]) * t)
    g = int(SKY_TOP[1] + (SKY_HOR[1] - SKY_TOP[1]) * t)
    b = int(SKY_TOP[2] + (SKY_HOR[2] - SKY_TOP[2]) * t)
    for x in range(LW):
        put(x, y, (r, g, b, 255))
        if (x * 17 + y * 11) % 53 == 0 and t < 0.5:
            put(x, y, (min(255, r + 10), min(255, g + 10), min(255, b + 10), 255))

# ── fluffy block clouds ──
# Each cloud is a list of (offset_x, offset_y, length) segments forming a fluffy row
def draw_cloud(bx, by, segments, thickness=3):
    rows = []
    max_w = max(sx + ln for sx, sy, ln in segments)
    for row in range(thickness):
        rows.append([])
        for sx, sy, ln in segments:
            # shrink rows toward bottom to round the cloud
            shrink = row
            start = sx + shrink
            end = sx + ln - shrink
            if end > start:
                rows[row].append((start, end))
    for row, spans in enumerate(rows):
        y = by + row
        if row == 0:
            color = CLOUD
        else:
            color = CLOUD_SHAD
        for start, end in spans:
            for x in range(start, end):
                put(bx + x, y, color)

clouds = [
    (0, 8,  [(0, 0, 6), (8, -1, 10), (20, 0, 5), (30, 1, 4)], 4),
    (58, 14, [(0, 0, 5), (8, -1, 7), (18, 0, 4)], 3),
    (28, 36, [(0, 0, 5), (7, -1, 6)], 3),
    (76, 44, [(0, 0, 4), (7, -1, 6), (15, 0, 4)], 3),
    (8, 56,  [(0, 0, 3)], 2),
]
for bx, by, segs, thick in clouds:
    draw_cloud(bx, by, segs, thick)

# ── rolling hills behind the portal ──
hills = []
for x in range(LW):
    h = 4 + int(smooth_noise(x, 0, 1.4) * 3)
    hills.append(h)

for x in range(LW):
    top = HORIZON - hills[x]
    for y in range(top, HORIZON):
        d = y - top
        if d < 2:
            put(x, y, TREE_LIGHT)
        elif d < 4:
            put(x, y, TREE_MID)
        else:
            put(x, y, TREE_DARK)

# ── blocky trees on the horizon ──
def draw_tree(cx, base_y, height):
    # trunk
    trunk_h = max(3, height // 4)
    for y in range(base_y - trunk_h, base_y + 1):
        put(cx, y, TRUNK)
        if random.random() < 0.5:
            put(cx + 1, y, TRUNK)
    # canopy: layered blocks, wider at bottom
    canopy_w = 3 + height // 5
    canopy_h = height * 3 // 4
    top = base_y - height
    for dx in range(-canopy_w, canopy_w + 1):
        for dy in range(canopy_h):
            # taper toward top
            if abs(dx) + dy // 2 > canopy_w + 1:
                continue
            x = cx + dx
            y = top + dy
            if 0 <= x < LW and 0 <= y < HORIZON:
                if dy == canopy_h - 1:
                    put(x, y, TREE_LIGHT)
                elif dy > canopy_h // 2:
                    put(x, y, TREE_MID)
                else:
                    put(x, y, TREE_DARK)

trees = [(12, 95, 16), (26, 96, 12), (74, 95, 14), (88, 96, 18), (96, 95, 11)]
for cx, base, h in trees:
    if abs(cx - 50) < 14:
        continue
    draw_tree(cx, base, h)

# ── meadow: organic grass patches ──
for x in range(LW):
    for y in range(HORIZON, LH):
        depth = (y - HORIZON) / (LH - HORIZON)
        n = noise(x, y, 5.6)
        if n > 0.35:
            base = GRASS_C
        elif n > 0.05:
            base = GRASS_A
        elif n > -0.25:
            base = GRASS_B
        else:
            base = GRASS_D
        if depth > 0.7:
            warm = (178, 162, 74) if (x + y) % 5 < 3 else (150, 136, 60)
            k = (depth - 0.7) / 0.3
            base = tuple(int(base[i] * (1 - k * 0.45) + warm[i] * k * 0.45) for i in range(3))
        put(x, y, base)

# subtle grass speckles
for _ in range(280):
    fx = random.randint(0, LW - 1)
    fy = random.randint(HORIZON + 4, LH - 1)
    c = (154, 210, 104) if random.random() < 0.5 else GRASS_DARK
    put(fx, fy, c)

# tall grass tufts
for _ in range(70):
    fx = random.randint(0, LW - 1)
    fy = random.randint(HORIZON + 18, LH - 2)
    h = random.randint(1, 3)
    for dy in range(h):
        put(fx, fy - dy, (185, 175, 85) if dy == 0 else (115, 138, 58))
    if random.random() < 0.5:
        put(fx + 1, fy, (115, 138, 58))

# ── flowers, keeping the portal lane clear ──
def flower_cluster(cx, cy, n, color):
    for _ in range(n):
        fx = cx + random.randint(-6, 6)
        fy = cy + random.randint(-4, 4)
        if 36 <= fx <= 64 and fy < 170:
            continue
        # flower head (2-3 pixels)
        put(fx, fy, color)
        put(fx + 1, fy, color)
        put(fx, fy - 1, FLOWER_CTR)
        put(fx, fy + 1, GRASS_DARK)
        if random.random() < 0.4:
            put(fx - 1, fy, color)

flower_cluster(16, 168, 6, FLOWER_Y)
flower_cluster(34, 190, 5, FLOWER_Y)
flower_cluster(80, 182, 5, FLOWER_W)
flower_cluster(10, 194, 4, FLOWER_W)
flower_cluster(90, 156, 4, FLOWER_Y)

# ── portal ──
PX, PY = 36, 50
PW, PH = 28, 72
CX = PX + PW // 2
BASE = PY + PH

# violet ground glow pool
for x in range(PX - 12, PX + PW + 12):
    for y in range(BASE, LH):
        dx = abs(CX - x) / (PW / 2 + 12)
        dy = (y - BASE) / (LH - BASE)
        d = math.hypot(dx * 0.85, dy * 2.8)
        if d < 1:
            blend(x, y, GLOW, 0.32 * (1 - d))

# contact shadow
for x in range(PX - 4, PX + PW + 4):
    for y in range(BASE - 1, BASE + 5):
        d = math.hypot((x - CX) / (PW / 2 + 4), (y - BASE + 1) / 5)
        if d < 1:
            blend(x, y, (20, 20, 20), 0.45 * (1 - d))

# obsidian frame: 4x4 blocks with top/left bevel
def obsidian_block(bx, by, size=4):
    colors = [OBS_DARK, OBS_MID, OBS_LIGHT]
    for dx in range(size):
        for dy in range(size):
            c = list(colors[(bx * 7 + by * 3 + dx + dy * 2) % 3])
            if dy == 0:
                c = [min(255, v + 20) for v in c]
            if dx == 0:
                c = [min(255, v + 10) for v in c]
            if random.random() < 0.1:
                c = OBS_HIGH
            put(PX + bx * size + dx, PY + by * size + dy, tuple(c) + (255,))

for bx in range(PW // 4):
    for by in range(PH // 4):
        obsidian_block(bx, by)

# interior void: Minecraft-style diagonal streaks
for x in range(PX + 4, PX + PW - 4):
    for y in range(PY + 4, PY + PH - 4):
        dx = (x - CX) / (PW / 2 - 4)
        dy = (y - (PY + PH / 2)) / (PH / 2 - 4)
        d = math.hypot(dx * 0.8, dy * 0.55)
        vein = math.sin((x * 0.7 + y * 1.1) + math.sin(x * 0.25 - y * 0.35) * 2.4)
        r = int(PORTAL_DEEP[0] + (PORTAL_MID[0] - PORTAL_DEEP[0]) * d + vein * 12)
        g = int(PORTAL_DEEP[1] + (PORTAL_MID[1] - PORTAL_DEEP[1]) * d + vein * 6)
        b = int(PORTAL_DEEP[2] + (PORTAL_MID[2] - PORTAL_DEEP[2]) * d + vein * 8)
        r = max(0, min(255, r))
        g = max(0, min(255, g))
        b = max(0, min(255, b))
        put(x, y, (r, g, b, 255))
        if random.random() < 0.014:
            put(x, y, PORTAL_LIT)
        elif random.random() < 0.008:
            put(x, y, (36, 16, 72, 255))

# inner rim light
for x in range(PX + 4, PX + PW - 4):
    put(x, PY + 4, (140, 105, 215, 255))
    put(x, PY + PH - 5, (82, 55, 132, 255))
for y in range(PY + 4, PY + PH - 4):
    put(PX + 4, y, (132, 96, 205, 255))
    put(PX + PW - 5, y, (86, 57, 138, 255))

# soft outer glow
for x in range(PX - 6, PX + PW + 6):
    for y in range(PY - 6, PY + PH + 6):
        on = PX <= x < PX + PW and PY <= y < PY + PH
        if not on:
            d = math.hypot(max(PX - x, x - (PX + PW - 1), 0), max(PY - y, y - (PY + PH - 1), 0))
            if d < 5 and random.random() < 0.32:
                blend(x, y, GLOW, 0.26 * (1 - d / 5))

# floating motes
for _ in range(34):
    side = random.choice([-1, 1])
    mx = int(CX + side * (PW / 2 + 2 + random.random() * 9))
    my = random.randint(PY - 5, PY + PH + 8)
    shade = (230, 205, 255, 255) if random.random() < 0.6 else (185, 145, 248, 255)
    put(mx, my, shade)
    if random.random() < 0.3:
        put(mx, my + 1, (248, 235, 255, 255))

# ── vignette ──
for x in range(LW):
    for y in range(LH):
        e = min(x, y, LW - 1 - x, LH - 1 - y)
        if e < 10:
            k = (10 - e) / 10 * 0.18
            b = img.getpixel((x, y))
            put(x, y, tuple(int(b[i] * (1 - k) + 10 * k) for i in range(3)) + (255,))

# ── scale and save ──
out = img.resize((W, H), Image.NEAREST)
out.save("identity-portal.png", "PNG")
print(f"wrote identity-portal.png ({W}x{H})")
