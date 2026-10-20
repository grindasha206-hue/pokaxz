"""Готовит атлас листьев из исходного листа текстур.

    python3 tools/build-leaf-atlas.py <leaves.png> <out-dir> [preview-dir]

Что делает:
  1. Находит листья по фактическим границам (связные области непрозрачных пикселей),
     а не режет лист на равные прямоугольники. Мелкие отдельные крапинки отбрасывает.
  2. Убирает цветную кайму: слабопрозрачный ореол вокруг контура обнуляется, а цвет
     пикселей на краю заменяется цветом соседних внутренних пикселей листа.
  3. Протягивает цвет листа под прозрачную область, чтобы на мипмапах не было тёмного
     или красного ободка.
  4. Кладёт каждый лист в свою клетку с прозрачными полями, не обрезая края.

Результат: leaf-color.jpg (цвет, без альфы), leaf-alpha.png (маска), leaf-atlas.json.
Цвет и маска хранятся раздельно: так браузер не предумножает альфу и не теряет цвет края.
"""
import json
import sys
from collections import deque

import numpy as np
from PIL import Image

TILE = 512
COLS, ROWS = 4, 2
PAD = 0.07          # поля клетки (доля стороны)
CORE_ALPHA = 160    # «тело» листа
EDGE_LO, EDGE_HI = 40, 200  # новая альфа края: линейно между этими значениями
NAMES = ['клён жёлтый', 'дуб красный', 'бук охристый', 'дуб бурый', 'берёза янтарная', 'клён медный']


def shift(a, dy, dx, fill=0):
    out = np.full_like(a, fill)
    h, w = a.shape[:2]
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[ys, xs] = a[yd, xd]
    return out


def dilate(m, r):
    out = m.copy()
    for _ in range(r):
        acc = out.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            acc |= shift(out, dy, dx, False)
        out = acc
    return out


def label(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    areas = [0]
    cur = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        cur += 1
        lab[y0, x0] = cur
        q = deque([(y0, x0)])
        n = 0
        while q:
            y, x = q.popleft()
            n += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = cur
                        q.append((yy, xx))
        areas.append(n)
    return lab, areas


def bleed(rgb, known, iters):
    """Заполняет неизвестные пиксели средним цветом известных соседей (послойно наружу)."""
    rgb = rgb.astype(np.float32).copy()
    known = known.copy()
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            k = shift(known, dy, dx, False)
            acc += shift(rgb, dy, dx, 0) * k[..., None]
            cnt += k
        grow = (~known) & (cnt > 0)
        if not grow.any():
            break
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        known = known | grow
    return rgb, known


def main(src, out_dir, preview_dir=None):
    im = np.array(Image.open(src).convert('RGBA')).astype(np.int32)
    a = im[..., 3]
    core = a >= CORE_ALPHA
    lab, areas = label(core)
    order = sorted(range(1, len(areas)), key=lambda k: -areas[k])
    leaves = order[:6]
    dropped = sum(1 for k in order[6:])
    print(f'листьев: {len(leaves)}, отброшено мелких областей: {dropped}, '
          f'площади: {[areas[k] for k in leaves]}')
    # порядок как в исходнике: сверху вниз, слева направо
    centers = []
    for k in leaves:
        ys, xs = np.nonzero(lab == k)
        centers.append((k, ys.mean(), xs.mean()))
    centers.sort(key=lambda c: (int(c[1] // (im.shape[0] / 2)), c[2]))

    color = np.zeros((TILE * ROWS, TILE * COLS, 3), np.uint8)
    alpha = np.zeros((TILE * ROWS, TILE * COLS), np.uint8)
    meta = []
    for idx, (k, _, _) in enumerate(centers):
        body = lab == k
        region = dilate(body, 3) & (a >= EDGE_LO)
        new_a = np.clip((a - EDGE_LO) / (EDGE_HI - EDGE_LO), 0, 1) * region
        ys, xs = np.nonzero(region)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        side = max(y1 - y0, x1 - x0)
        pad = int(side * PAD) + 4
        size = side + 2 * pad
        cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
        sy0, sx0 = cy - size // 2, cx - size // 2

        tile_rgb = np.zeros((size, size, 3), np.float32)
        tile_a = np.zeros((size, size), np.float32)
        tile_known = np.zeros((size, size), bool)
        # копируем только этот лист (соседи и крапинки не попадают в клетку)
        for yy in range(size):
            sy = sy0 + yy
            if not (0 <= sy < im.shape[0]):
                continue
            lo, hi = max(0, sx0), min(im.shape[1], sx0 + size)
            row = slice(lo - sx0, hi - sx0)
            tile_rgb[yy, row] = im[sy, lo:hi, :3]
            tile_a[yy, row] = new_a[sy, lo:hi]
            # «надёжный» цвет — только почти непрозрачные пиксели этого листа
            tile_known[yy, row] = body[sy, lo:hi] & (a[sy, lo:hi] >= 235)
        # цвет края и всего прозрачного поля — из внутренних пикселей листа
        filled, known = bleed(tile_rgb, tile_known, 12)
        mean = tile_rgb[tile_known].mean(0)
        filled, known = bleed(filled, known, 24)  # дальше — средний цвет листа
        filled[~known] = mean
        # плавно: внутри листа исходный цвет, у края — протянутый
        w = np.clip((tile_a - 0.85) / 0.15, 0, 1)[..., None] * tile_known[..., None]
        final = tile_rgb * w + filled * (1 - w)

        rgb_img = Image.fromarray(np.clip(final, 0, 255).astype(np.uint8)).resize((TILE, TILE), Image.LANCZOS)
        a_img = Image.fromarray((tile_a * 255).astype(np.uint8)).resize((TILE, TILE), Image.LANCZOS)
        col, rowi = idx % 3, idx // 3
        color[rowi * TILE:(rowi + 1) * TILE, col * TILE:(col + 1) * TILE] = np.array(rgb_img)
        alpha[rowi * TILE:(rowi + 1) * TILE, col * TILE:(col + 1) * TILE] = np.array(a_img)
        scale = TILE / size
        meta.append({
            'name': NAMES[idx], 'col': col, 'row': rowi,
            # размеры листа внутри клетки (доли стороны) — для радиуса выбора и масштаба
            'w': round((x1 - x0) * scale / TILE, 4), 'h': round((y1 - y0) * scale / TILE, 4),
            'area': round(float((tile_a > 0.5).sum()) * scale * scale / TILE / TILE, 4),
        })
        print(f'  {NAMES[idx]}: {x1 - x0}×{y1 - y0} px, клетка {col},{rowi}')

    # пустые клетки: средний цвет, нулевая альфа
    color[:, 3 * TILE:] = color[:, :3 * TILE].reshape(-1, 3).mean(0).astype(np.uint8)
    Image.fromarray(color).save(f'{out_dir}/leaf-color.jpg', quality=92, subsampling=0)
    Image.fromarray(alpha).save(f'{out_dir}/leaf-alpha.png', optimize=True)
    with open(f'{out_dir}/leaf-atlas.json', 'w') as fh:
        json.dump({'cols': COLS, 'rows': ROWS, 'tile': TILE, 'leaves': meta}, fh, ensure_ascii=False, indent=1)

    # контроль каймы: проверяем цвет на краю (альфа 0.1–0.9) против цвета внутри
    edge = (alpha > 25) & (alpha < 230)
    inner = alpha >= 250
    ce = color[edge].astype(float).mean(0)
    ci = color[inner].astype(float).mean(0)
    print(f'средний цвет края {ce.round()}, внутри {ci.round()}')

    if preview_dir:
        af = alpha[..., None].astype(float) / 255
        for name, bg in (('grey', 128), ('white', 245), ('black', 10), ('green', (90, 110, 60))):
            comp = color * af + np.array(bg, float) * (1 - af)
            Image.fromarray(comp.astype(np.uint8)).save(f'{preview_dir}/atlas-on-{name}.png')
        # исходник на тех же фонах — для сравнения
        oa = im[..., 3:4] / 255
        Image.fromarray((im[..., :3] * oa + 245 * (1 - oa)).astype(np.uint8)).save(f'{preview_dir}/source-on-white.png')


if __name__ == '__main__':
    main(*sys.argv[1:])
