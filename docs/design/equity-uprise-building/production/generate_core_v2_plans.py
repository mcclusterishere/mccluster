#!/usr/bin/env python3
"""
Generate Equity Uprise Core V2 canonical schematic plan references.

Inputs:
  - production/building-core-v2.json
  - production/core-v2-floor-programs.json

Outputs:
  - versioned DXF/SVG/PNG plan files under references/floor-01 ... floor-07
  - combined contact sheet
  - generation manifest

NOT FOR CONSTRUCTION.
"""

from pathlib import Path
import json, math, textwrap
from PIL import Image, ImageDraw, ImageFont
import ezdxf

HERE=Path(__file__).resolve().parent
BUILDING=HERE.parent
REFS=BUILDING/"references"
core=json.loads((HERE/"building-core-v2.json").read_text())
programs=json.loads((HERE/"core-v2-floor-programs.json").read_text())
b1=json.loads((HERE/"basement-b1-program.json").read_text())
plan_levels=[b1]+programs["levels"]

OUT_NAMES={
  0:"equity-uprise-basement-b1-core-v2-schematic-v1",
  1:"equity-uprise-floor-01-core-v2-schematic-v1",
  2:"equity-uprise-floor-02-public-forum-core-v2-schematic-v1",
  3:"equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1",
  4:"equity-uprise-floor-04-media-culture-core-v2-schematic-v1",
  5:"equity-uprise-floor-05-policy-proof-core-v2-schematic-v1",
  6:"equity-uprise-floor-06-penthouse-command-core-v2-schematic-v1",
  7:"equity-uprise-level-07-roof-mobility-portal-core-v2-schematic-v1",
}

def b4(d):
    return (d["x1"],d["y1"],d["x2"],d["y2"])

vs=core["vertical_systems"]
CORE={
 "passenger_elevator":b4(vs["passenger_elevator"]["shaft_bounds_ft"]),
 "freight_elevator":b4(vs["service_freight_elevator"]["shaft_bounds_ft"]),
 "stair_b":b4(vs["stair_b"]["enclosure_bounds_ft"]),
 "stair_a":b4(vs["stair_a"]["enclosure_bounds_ft"]),
 "mep":b4(vs["mep_riser"]["bounds_ft"]),
 "stair_b_open":b4(vs["stair_b"]["slab_opening_bounds_ft"]),
 "stair_a_open":b4(vs["stair_a"]["slab_opening_bounds_ft"]),
}
common=programs["common_support"]

def support_zones(level):
    if level.get("roof"): return []
    if level.get("basement"):
        return [("MEP / RISERS",CORE["mep"],"service")]
    a,b=level["support_names"]
    return [
      ("PUBLIC / SUPPORT CORRIDOR",b4(common["corridor"]["bounds_ft"]),"corridor"),
      ("RESTROOM A",b4(common["restroom_a"]["bounds_ft"]),"room"),
      ("RESTROOM B",b4(common["restroom_b"]["bounds_ft"]),"room"),
      (a.upper(),b4(common["support_a"]["bounds_ft"]),"service"),
      (b.upper(),b4(common["support_b"]["bounds_ft"]),"service"),
      ("JANITOR",b4(common["janitor"]["bounds_ft"]),"service"),
      ("MEP / RISERS",CORE["mep"],"service"),
    ]

def core_zones():
    return [
      ("FREIGHT / SERVICE ELEVATOR",CORE["freight_elevator"],"core"),
      ("STAIR B",CORE["stair_b"],"core"),
      ("PASSENGER ELEVATOR",CORE["passenger_elevator"],"core"),
      ("STAIR A",CORE["stair_a"],"core"),
    ]

def fill(kind):
    return {"zone":"#f1f1ed","room":"#e4e5e5","feature":"#d5d6d4","furniture":"#c7c0b8",
            "terminal":"#bec4c8","service":"#deded9","core":"#b9bdc2","corridor":"#fafaf7"}.get(kind,"#eeeeea")

def esc(s):
    return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")

def zones(level):
    out=[]
    for z in level.get("zones",[]):
        out.append((z["label"].upper(),b4(z["bounds_ft"]),z["kind"]))
    out+=support_zones(level)
    out+=core_zones()
    if level.get("roof"):
        out.append(("MEP / ROOF SERVICES",CORE["mep"],"service"))
    return out

def circles(level):
    out=[(x["label"].upper(),(x["center_ft"]["x"],x["center_ft"]["y"]),x["radius_ft"],x["kind"]) for x in level.get("circles",[])]
    out += [(x["label"].upper(),(x["center_ft"]["x"],x["center_ft"]["y"]),x["radius_ft"],x.get("kind","instrument")) for x in level.get("spheres",[])]
    return out

def level_label(level):
    return "BASEMENT B1" if level.get("basement") else f"LEVEL {level['level']:02d}"

def elev_label(v):
    return f"{v:+g} FT"

def ref_dir(level):
    return REFS/"basement-b1" if level.get("basement") else REFS/f"floor-{level['level']:02d}"

def font(size,bold=False):
    p="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    try:return ImageFont.truetype(p,size)
    except:return ImageFont.load_default()

def dashed_rect(draw,xy,fillc=(120,25,25),width=2):
    x1,y1,x2,y2=xy
    def line(a,b):
        ax,ay=a; bx,by=b; L=math.hypot(bx-ax,by-ay)
        if not L:return
        ux=(bx-ax)/L; uy=(by-ay)/L; t=0
        while t<L:
            e=min(L,t+8); draw.line((ax+ux*t,ay+uy*t,ax+ux*e,ay+uy*e),fill=fillc,width=width); t+=13
    line((x1,y1),(x2,y1));line((x2,y1),(x2,y2));line((x2,y2),(x1,y2));line((x1,y2),(x1,y1))

def png(level,path):
    W,H=1600,1680;m=180;s=17
    im=Image.new("RGB",(W,H),"white");d=ImageDraw.Draw(im)
    X=lambda x:m+x*s;Y=lambda y:m+(72-y)*s
    d.text((90,45),f"EQUITY UPRISE — {level_label(level)} — {level['title'].upper()}",font=font(30,True),fill="black")
    ffe=level["elevation_ft"]
    d.text((90,90),f"CORE V2 SCHEMATIC PLAN · FFE {elev_label(ffe)} · NOT FOR CONSTRUCTION",font=font(18),fill=(55,55,55))
    for g in [0,18,36,54,72]:
        d.line((X(g),Y(0),X(g),Y(72)),fill=(215,215,215));d.line((X(0),Y(g),X(72),Y(g)),fill=(215,215,215))
    d.rectangle((X(0),Y(72),X(72),Y(0)),outline="black",width=5)
    for label,b,kind in zones(level):
        x1,y1,x2,y2=b;rect=(X(x1),Y(y2),X(x2),Y(y1));d.rectangle(rect,fill=fill(kind),outline=(55,55,55),width=2)
        txt="\n".join(textwrap.wrap(label,max(9,int((x2-x1)*2.1)),break_long_words=False))
        ff=font(11 if x2-x1<7 or y2-y1<6 else 14)
        bb=d.multiline_textbbox((0,0),txt,font=ff,spacing=2,align="center")
        d.multiline_text(((rect[0]+rect[2])/2-(bb[2]-bb[0])/2,(rect[1]+rect[3])/2-(bb[3]-bb[1])/2),txt,font=ff,fill=(20,20,20),spacing=2,align="center")
    for label,(cx,cy),r,kind in circles(level):
        xy=(X(cx-r),Y(cy+r),X(cx+r),Y(cy-r));d.ellipse(xy,fill=fill(kind),outline=(55,55,55),width=2)
        d.text((X(cx),Y(cy)),label,font=font(12),fill=(20,20,20),anchor="mm")
    for b in (CORE["stair_b_open"],CORE["stair_a_open"]):
        x1,y1,x2,y2=b;dashed_rect(d,(X(x1),Y(y2),X(x2),Y(y1)))
    d.ellipse((X(36)-8,Y(28)-8,X(36)+8,Y(28)+8),fill="white",outline="black",width=2);d.text((X(36)+12,Y(28)-8),"360",font=font(11),fill="black")
    d.text((X(36),Y(0)+18),level["south_condition"].upper(),font=font(13),fill=(60,60,60),anchor="ma")
    notes=[
      "CORE V2: West Service Core X0–18 / Y54–72",
      "Freight/service elevator X0–8 / Y60–72 · Stair B X8–18 / Y54–72",
      "Passenger elevator X54–62 / Y34–44 · Stair A X60–72 / Y54–72",
      "Both stairs rise 13'-6\" between finished floors in combined geometry.",
      "Schematic only — final licensed design/code review required."
    ]
    for i,n in enumerate(notes):d.text((90,1450+i*28),n,font=font(14),fill=(45,45,45))
    im.save(path)

def svg(level,path):
    W,H=1000,1060;m=90;s=11.5;X=lambda x:m+x*s;Y=lambda y:m+(72-y)*s
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         '<style>.t{font-family:Arial,sans-serif;fill:#111}.small{font-size:9px}.med{font-size:11px}.title{font-size:18px;font-weight:700}.room{stroke:#444;stroke-width:1.5}.grid{stroke:#ddd;stroke-width:1}.shell{fill:none;stroke:#111;stroke-width:3}.open{fill:none;stroke:#8a1f23;stroke-width:1.5;stroke-dasharray:5 4}</style>',
         f'<text x="55" y="35" class="t title">EQUITY UPRISE — {esc(level_label(level))} — {esc(level["title"].upper())}</text>',
         f'<text x="55" y="55" class="t med">CORE V2 SCHEMATIC PLAN · FFE {esc(elev_label(level["elevation_ft"]))} · NOT FOR CONSTRUCTION</text>']
    for g in [0,18,36,54,72]:
        out += [f'<line x1="{X(g)}" y1="{Y(0)}" x2="{X(g)}" y2="{Y(72)}" class="grid"/>',f'<line x1="{X(0)}" y1="{Y(g)}" x2="{X(72)}" y2="{Y(g)}" class="grid"/>']
    out.append(f'<rect x="{X(0)}" y="{Y(72)}" width="{72*s}" height="{72*s}" class="shell"/>')
    for label,b,kind in zones(level):
        x1,y1,x2,y2=b;out.append(f'<rect x="{X(x1)}" y="{Y(y2)}" width="{(x2-x1)*s}" height="{(y2-y1)*s}" fill="{fill(kind)}" class="room"/>')
        out.append(f'<text x="{(X(x1)+X(x2))/2}" y="{(Y(y1)+Y(y2))/2}" text-anchor="middle" dominant-baseline="middle" class="t small">{esc(label)}</text>')
    for label,(cx,cy),r,kind in circles(level):
        out += [f'<circle cx="{X(cx)}" cy="{Y(cy)}" r="{r*s}" fill="{fill(kind)}" class="room"/>',f'<text x="{X(cx)}" y="{Y(cy)}" text-anchor="middle" dominant-baseline="middle" class="t small">{esc(label)}</text>']
    for b in (CORE["stair_b_open"],CORE["stair_a_open"]):
        x1,y1,x2,y2=b;out.append(f'<rect x="{X(x1)}" y="{Y(y2)}" width="{(x2-x1)*s}" height="{(y2-y1)*s}" class="open"/>')
    out += [f'<circle cx="{X(36)}" cy="{Y(28)}" r="4" fill="#fff" stroke="#111"/>',
            f'<text x="{X(36)+8}" y="{Y(28)-3}" class="t small">360</text>',
            f'<text x="{X(36)}" y="{Y(0)+22}" text-anchor="middle" class="t med">{esc(level["south_condition"].upper())}</text>',
            '<text x="55" y="955" class="t med">West Service Core X0–18/Y54–72 · Freight X0–8/Y60–72 · Stair B X8–18/Y54–72</text>',
            '<text x="55" y="975" class="t med">Passenger elevator X54–62/Y34–44 · Stair A X60–72/Y54–72 · full 13\'-6&quot; rise</text>',
            '<text x="55" y="995" class="t med">Schematic only — final licensed design/code review required.</text>','</svg>']
    path.write_text("\n".join(out),encoding="utf-8")

def dxf(level,path):
    doc=ezdxf.new("R2010",setup=True);m=doc.modelspace()
    for name,color in [("SHELL",7),("GRID",8),("CORE",1),("PROGRAM",3),("SUPPORT",4),("OPENINGS",1),("TEXT",7)]:
        if name not in doc.layers:doc.layers.add(name,color=color)
    def rect(b,layer):
        x1,y1,x2,y2=b;m.add_lwpolyline([(x1,y1),(x2,y1),(x2,y2),(x1,y2),(x1,y1)],dxfattribs={"layer":layer})
    rect((0,0,72,72),"SHELL")
    for g in [0,18,36,54,72]:
        m.add_line((g,0),(g,72),dxfattribs={"layer":"GRID"});m.add_line((0,g),(72,g),dxfattribs={"layer":"GRID"})
    for label,b,kind in zones(level):
        rect(b,"SUPPORT" if kind in ("service","corridor") else ("CORE" if kind=="core" else "PROGRAM"))
        x1,y1,x2,y2=b;m.add_text(label,dxfattribs={"layer":"TEXT","height":0.55}).set_placement(((x1+x2)/2,(y1+y2)/2))
    for label,(cx,cy),r,kind in circles(level):
        m.add_circle((cx,cy),r,dxfattribs={"layer":"PROGRAM"});m.add_text(label,dxfattribs={"layer":"TEXT","height":0.55}).set_placement((cx,cy))
    for b in (CORE["stair_b_open"],CORE["stair_a_open"]):rect(b,"OPENINGS")
    m.add_circle((36,28),0.45,dxfattribs={"layer":"TEXT"});m.add_text("360 CAMERA",dxfattribs={"layer":"TEXT","height":0.5}).set_placement((36.7,28))
    m.add_text(f"CORE V2 {level_label(level)} {level['title'].upper()} FFE {elev_label(level['elevation_ft'])}",dxfattribs={"layer":"TEXT","height":0.8}).set_placement((2,75))
    m.add_text("NOT FOR CONSTRUCTION",dxfattribs={"layer":"TEXT","height":0.65}).set_placement((2,-3))
    doc.saveas(path)

manifest=[]
for level in plan_levels:
    n=level["level"];d=ref_dir(level);d.mkdir(parents=True,exist_ok=True);base=OUT_NAMES[n]
    paths={"png":d/f"{base}.png","svg":d/f"{base}.svg","dxf":d/f"{base}.dxf"}
    png(level,paths["png"]);svg(level,paths["svg"]);dxf(level,paths["dxf"])
    manifest.append({"level":n,"title":level["title"],"elevation_ft":level["elevation_ft"],"files":{k:str(v.relative_to(BUILDING)) for k,v in paths.items()}})

# contact sheet
ims=[Image.open(ref_dir(x)/f"{OUT_NAMES[x['level']]}.png").resize((400,420)) for x in plan_levels]
sheet=Image.new("RGB",(1200,1260),"white")
for i,im in enumerate(ims):sheet.paste(im,((i%3)*400,(i//3)*420))
sheet.save(REFS/"equity-uprise-core-v2-plan-contact-sheet.png")
(REFS/"core-v2-plan-generation-manifest.json").write_text(json.dumps(manifest,indent=2))
print("Generated Core V2 plan references for B1 and levels 1–7")
