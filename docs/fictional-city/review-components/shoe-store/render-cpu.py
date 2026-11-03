"""Deterministic CPU mesh review with depth buffering, not a browser screenshot."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parent
records = json.loads((root / 'output/mesh-review.json').read_text())
width, height = 1440, 1080
cam = np.array([16., 19., 23.])
forward = -cam / np.linalg.norm(cam)
right = np.cross(forward, [0, 1, 0]); right /= np.linalg.norm(right)
up = np.cross(right, forward)
light = np.array([-.4, .85, .4]); light /= np.linalg.norm(light)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    titlefont = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
except OSError:
    font = titlefont = None
for floor, title in [('retail', 'DESIGNER KICKS / SHOWROOM + BACKROOM'), ('factory', 'DESIGNER KICKS / SHOE + CLOTHING FACTORY')]:
    pixels = np.full((height, width, 3), [36, 52, 53], dtype=np.uint8)
    depth_buffer = np.full((height, width), np.inf)
    for rec in records:
        if rec['floor'] != floor: continue
        points = np.array(rec['positions']).reshape((-1, 3))
        indices = np.array(rec['faces']).reshape((-1, 3))
        color = np.array([int(rec['color'][k:k+2], 16) for k in [0, 2, 4]])
        for face in indices:
            triangle = points[face]
            normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
            norm = np.linalg.norm(normal)
            if norm < 1e-10: continue
            normal /= norm
            if normal @ (-forward) <= 0: continue
            xy = np.column_stack((720 + (triangle @ right) * 46, 600 - (triangle @ up) * 46))
            lo = np.maximum(np.floor(xy.min(axis=0)).astype(int), [0, 0])
            hi = np.minimum(np.ceil(xy.max(axis=0)).astype(int), [width-1, height-1])
            if np.any(lo > hi): continue
            x, y = np.meshgrid(np.arange(lo[0], hi[0]+1)+.5, np.arange(lo[1], hi[1]+1)+.5)
            a, b, c = xy
            denom = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(denom) < 1e-10: continue
            wa = ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denom
            wb = ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denom
            wc = 1-wa-wb
            inside = (wa >= -1e-8) & (wb >= -1e-8) & (wc >= -1e-8)
            d = triangle @ forward
            depth = wa*d[0]+wb*d[1]+wc*d[2]
            region = depth_buffer[lo[1]:hi[1]+1, lo[0]:hi[0]+1]
            mask = inside & (depth < region)
            region[mask] = depth[mask]
            shaded = np.clip(color*(.55+.45*max(0, normal @ light)), 0, 255).astype(np.uint8)
            pixels[lo[1]:hi[1]+1, lo[0]:hi[0]+1][mask] = shaded
    im = Image.fromarray(pixels); draw = ImageDraw.Draw(im)
    draw.text((40, 34), title, fill='#e9dfc9', font=titlefont)
    draw.text((40, 82), 'AUTHORED GAME MODEL REVIEW | 18 x 14 m per floor | not a surveyed interior or live city integration', fill='#c3c5b6', font=font)
    draw.text((40, 1010), 'CPU render of procedural mesh assembly. Browser, phone visual QA and Blender import are still required.', fill='#c3c5b6', font=font)
    im.save(root / 'output' / f'{floor}-model-review.png')
print('Wrote two deterministic CPU mesh views')
