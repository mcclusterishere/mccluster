#!/usr/bin/env python3
"""Render exact generated geometry for visual QA and palette thumbnails.

Optional Pillow dependency; the GLB generator itself needs no third-party code.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from generate_assets import make_asset, MATERIALS, dot, cross, normal

ROOT=Path(__file__).resolve().parent
OUT=ROOT/"previews"
OUT.mkdir(exist_ok=True)
catalog=json.loads((ROOT/"catalog.json").read_text())
view=normal((1.1,.85,1.4))
right=normal(cross((0,1,0),view))
up=cross(view,right)
light=normal((-.4,1.3,.7))

def font(size,bold=False):
    base="/usr/share/fonts/truetype/dejavu/DejaVuSans"
    try:return ImageFont.truetype(base+("-Bold" if bold else "")+".ttf",size)
    except OSError:return ImageFont.load_default()

def preview(asset,size=384):
    m=make_asset(asset["id"])
    img=Image.new("RGB",(size,size),(236,240,239));d=ImageDraw.Draw(img)
    points=[tuple(g["p"][i:i+3]) for g in m.groups.values() for i in range(0,len(g["p"]),3)]
    coords=[(dot(p,right),-dot(p,up)) for p in points]
    x0=min(p[0] for p in coords);x1=max(p[0] for p in coords)
    y0=min(p[1] for p in coords);y1=max(p[1] for p in coords)
    scale=min(size*.80/max(.1,x1-x0),size*.74/max(.1,y1-y0))
    cx=(x0+x1)/2;cy=(y0+y1)/2
    def project(p):return(size/2+(dot(p,right)-cx)*scale,size*.48+(-dot(p,up)-cy)*scale)
    floor_y=project((0,0,0))[1]
    sw=min(size*.4,(asset["width"]+asset["depth"])*scale*.16)
    d.ellipse((size/2-sw,floor_y-sw*.2,size/2+sw,floor_y+sw*.3),fill=(214,222,219))
    faces=[]
    for mat,g in m.groups.items():
        rgb=MATERIALS[mat][0][:3]
        for i in range(0,len(g["i"]),3):
            ids=g["i"][i:i+3]
            n=tuple(g["n"][ids[0]*3:ids[0]*3+3])
            if dot(n,view)<=.001:continue
            p=[tuple(g["p"][k*3:k*3+3]) for k in ids]
            depth=sum(dot(v,view) for v in p)/3
            shade=.58+.42*max(0,dot(n,light))
            # GLB base colors are linear; convert to sRGB for matching previews.
            color=tuple(round(255*max(0,min(1,(c*shade)**(1/2.2)))) for c in rgb)
            faces.append((depth,[project(v) for v in p],color))
    for _,p,c in sorted(faces,key=lambda x:x[0]):d.polygon(p,fill=c)
    return img

for asset in catalog["assets"]:
    preview(asset).save(OUT/(asset["id"]+".png"))

W,H=1600,2050
sheet=Image.new("RGB",(W,H),(245,247,246));d=ImageDraw.Draw(sheet)
d.text((42,28),"PRIM3 / WHITE INDUSTRIAL",font=font(35,True),fill=(23,36,38))
d.text((44,80),"24 reusable 3D assets  ·  12,104 total triangles  ·  original procedural geometry",font=font(19),fill=(70,86,85))
cw,ch=375,300
for i,asset in enumerate(catalog["assets"]):
    x=40+(i%4)*390;y=133+(i//4)*312
    d.rounded_rectangle((x,y,x+cw,y+ch),radius=12,fill=(255,255,253),outline=(212,221,218),width=1)
    thumb=Image.open(OUT/(asset["id"]+".png")).resize((230,230))
    d.rectangle((x+10,y+10,x+cw-10,y+240),fill=(236,240,239))
    sheet.paste(thumb,(x+(cw-230)//2,y+10))
    d.text((x+16,y+248),asset["name"],font=font(18,True),fill=(31,46,47))
    fp=asset["footprint"]
    caption=f'{fp["width"]:g} × {fp["depth"]:g} footprint  /  {asset["statistics"]["triangles"]:,} tris'
    d.text((x+16,y+275),caption,font=font(14),fill=(84,99,99))
sheet.save(ROOT/"asset-kit-overview.png")
print(f"Rendered {len(catalog['assets'])} thumbnails and asset-kit-overview.png")
