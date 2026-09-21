#!/usr/bin/env python3
"""
Generate Equity Uprise Core V2 canonical schematic plan references.

Inputs:
  - production/building-core-v2.json
  - production/core-v2-floor-programs.json
  - production/basement-b1-program.json
  - production/floor-01/floor-01-site-egress.json

Outputs:
  - B1 + Floor 1–7 interior/chassis DXF/SVG/PNG references
  - Floor 1 site/life-safety DXF/SVG/PNG references
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
site=json.loads((HERE/"floor-01"/"floor-01-site-egress.json").read_text())
plan_levels=[b1]+programs["levels"]
SITE_OUT_NAME="equity-uprise-floor-01-site-egress-core-v2-schematic-v1"

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

def program_status(level):
    if level.get("basement"):
        return "RESTRICTED SUPPORT / UNDERGROUND OPERATIONS"
    if level.get("design_maturity")=="reconciled-current-iterative-pass":
        return "PROGRAM RECONCILED — BASIC RENDER READY"
    return "PROGRAM PROVISIONAL — CHASSIS ONLY"

def floor1_opening_segments():
    out=[]
    for obj in site.get("exterior_openings",[]):
        if obj.get("object_id") not in {"F1-DOOR-STAIR-A-DISCHARGE","F1-DOOR-STAIR-B-DISCHARGE","F1-DOOR-SERVICE-WEST"}:
            continue
        loc=obj["location"]; facade=loc.get("facade")
        if facade=="east":
            a=(72,loc["y1"]); b=(72,loc["y2"])
        elif facade=="west":
            a=(0,loc["y1"]); b=(0,loc["y2"])
        elif facade=="north":
            a=(loc["x1"],72); b=(loc["x2"],72)
        else:
            continue
        out.append((obj["label"].upper(),a,b))
    return out

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
    d.text((90,125),program_status(level),font=font(16,True),fill=(115,25,29) if "PROVISIONAL" in program_status(level) else (55,55,55))
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
    if level.get("level")==1:
        for label,a,b in floor1_opening_segments():
            d.line((X(a[0]),Y(a[1]),X(b[0]),Y(b[1])),fill=(133,26,29),width=7)
            mx=(X(a[0])+X(b[0]))/2; my=(Y(a[1])+Y(b[1]))/2
            d.text((mx+6,my-14),label,font=font(10,True),fill=(115,25,29))
    if level.get("basement"):
        d.line((X(34),Y(72),X(34),Y(76)),fill=(39,103,122),width=5)
        d.text((X(35),Y(75)-12),"TO FUTURE UNDERGROUND NETWORK — GEOMETRY RESERVED",font=font(10,True),fill=(39,103,122))
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
         f'<text x="55" y="55" class="t med">CORE V2 SCHEMATIC PLAN · FFE {esc(elev_label(level["elevation_ft"]))} · NOT FOR CONSTRUCTION</text>',
         f'<text x="55" y="75" class="t med">{esc(program_status(level))}</text>']
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
    if level.get("level")==1:
        for label,a,b in floor1_opening_segments():
            out.append(f'<line x1="{X(a[0])}" y1="{Y(a[1])}" x2="{X(b[0])}" y2="{Y(b[1])}" stroke="#851A1D" stroke-width="5"/>')
            out.append(f'<text x="{(X(a[0])+X(b[0]))/2+5}" y="{(Y(a[1])+Y(b[1]))/2-7}" class="t small">{esc(label)}</text>')
    if level.get("basement"):
        out.append(f'<line x1="{X(34)}" y1="{Y(72)}" x2="{X(34)}" y2="{Y(76)}" stroke="#27677A" stroke-width="4"/>')
        out.append(f'<text x="{X(35)}" y="{Y(75)-7}" class="t small">TO FUTURE UNDERGROUND NETWORK — GEOMETRY RESERVED</text>')
    out += [f'<circle cx="{X(36)}" cy="{Y(28)}" r="4" fill="#fff" stroke="#111"/>',
            f'<text x="{X(36)+8}" y="{Y(28)-3}" class="t small">360</text>',
            f'<text x="{X(36)}" y="{Y(0)+22}" text-anchor="middle" class="t med">{esc(level["south_condition"].upper())}</text>',
            '<text x="55" y="955" class="t med">West Service Core X0–18/Y54–72 · Freight X0–8/Y60–72 · Stair B X8–18/Y54–72</text>',
            '<text x="55" y="975" class="t med">Passenger elevator X54–62/Y34–44 · Stair A X60–72/Y54–72 · full 13\'-6&quot; rise</text>',
            '<text x="55" y="995" class="t med">Schematic only — final licensed design/code review required.</text>','</svg>']
    path.write_text("\n".join(out),encoding="utf-8")

def plan_readme(level,base):
    label="Basement B1" if level.get("basement") else f"Floor {level['level']:02d}"
    if level.get("basement"):
        status="RESTRICTED CORE V2 PLAN REFERENCE"
    elif level.get("design_maturity")=="reconciled-current-iterative-pass":
        status="ACTIVE CORE V2 PLAN REFERENCE"
    else:
        status="PROVISIONAL CORE V2 CHASSIS PLAN — PROGRAM PRE-ITERATIVE"
    authority="basement-b1-program.json" if level.get("basement") else "core-v2-floor-programs.json"
    site_files=""
    site_authority=""
    if level.get("level")==1:
        site_files=f"""
Additional generated Floor 1 site/life-safety references:
- `{SITE_OUT_NAME}.dxf`
- `{SITE_OUT_NAME}.svg`
- `{SITE_OUT_NAME}.png`
"""
        site_authority="- `production/floor-01/floor-01-site-egress.json`\n"
    return f"""# {label} — {level['title']} — Core V2 Plan References

> Status: **{status} / NOT FOR CONSTRUCTION**

Generated from:
- `production/building-core-v2.json`
- `production/{authority}`
{site_authority}- `production/generate_core_v2_plans.py`

Primary plan files:
- `{base}.dxf`
- `{base}.svg`
- `{base}.png`
{site_files}
Finished-floor elevation: **{elev_label(level['elevation_ft'])}**.

These files are **generated-only**. Do not hand-edit them or treat this README as geometry authority.

The machine-readable source files above control title, level identity, program zones, shared vertical systems, and regeneration.

Design maturity: **{level.get('design_maturity','support-level' if level.get('basement') else 'unspecified')}**.
"""

def dxf(level,path):
    doc=ezdxf.new("R2010",setup=True);m=doc.modelspace()
    for name,color in [("SHELL",7),("GRID",8),("CORE",1),("PROGRAM",3),("SUPPORT",4),("OPENINGS",1),("EGRESS",1),("TEXT",7)]:
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
    if level.get("level")==1:
        for label,a,b in floor1_opening_segments():
            m.add_line(a,b,dxfattribs={"layer":"EGRESS"})
            m.add_text(label,dxfattribs={"layer":"TEXT","height":0.45}).set_placement(((a[0]+b[0])/2+0.5,(a[1]+b[1])/2))
    if level.get("basement"):
        m.add_line((34,72),(34,78),dxfattribs={"layer":"EGRESS"})
        m.add_text("TO FUTURE UNDERGROUND NETWORK - GEOMETRY RESERVED",dxfattribs={"layer":"TEXT","height":0.45}).set_placement((35,76))
    m.add_circle((36,28),0.45,dxfattribs={"layer":"TEXT"});m.add_text("360 CAMERA",dxfattribs={"layer":"TEXT","height":0.5}).set_placement((36.7,28))
    m.add_text(f"CORE V2 {level_label(level)} {level['title'].upper()} FFE {elev_label(level['elevation_ft'])}",dxfattribs={"layer":"TEXT","height":0.8}).set_placement((2,75))
    m.add_text(program_status(level),dxfattribs={"layer":"TEXT","height":0.55}).set_placement((2,73.5))
    m.add_text("NOT FOR CONSTRUCTION",dxfattribs={"layer":"TEXT","height":0.65}).set_placement((2,-3))
    doc.saveas(path)


def site_plan_png(path):
    W,H=1700,1700; m=150
    sb=site["site_bounds_ft"]; sx=sb["x2"]-sb["x1"]; sy=sb["y2"]-sb["y1"]; s=min((W-2*m)/sx,(H-2*m)/sy)
    X=lambda x:m+(x-sb["x1"])*s
    Y=lambda y:H-m-(y-sb["y1"])*s
    im=Image.new("RGB",(W,H),"white"); d=ImageDraw.Draw(im)
    d.text((85,38),"EQUITY UPRISE — FLOOR 01 SITE / LIFE-SAFETY SCHEMATIC",font=font(30,True),fill="black")
    d.text((85,82),"LEVEL OF EXIT DISCHARGE · GENERATED FROM floor-01-site-egress.json · NOT FOR CONSTRUCTION",font=font(17),fill=(55,55,55))
    def rr(b,fillc,outline=(70,70,70),width=2):
        d.rectangle((X(b["x1"]),Y(b["y2"]),X(b["x2"]),Y(b["y1"])),fill=fillc,outline=outline,width=width)
    kind_fill={"public_way":(205,205,205),"walk":(225,225,218),"egress_walk":(220,230,225),"service":(210,200,188),"assembly":(218,228,210)}
    for item in site.get("site_elements",[]):
        if "bounds_ft" in item:
            rr(item["bounds_ft"],kind_fill.get(item.get("kind"),(235,235,232)))
            b=item["bounds_ft"]; d.text(((X(b["x1"])+X(b["x2"]))/2,(Y(b["y1"])+Y(b["y2"]))/2),item["label"].upper(),font=font(10,True),fill=(35,35,35),anchor="mm")
        elif "polyline_ft" in item:
            pts=[(X(x),Y(y)) for x,y in item["polyline_ft"]]
            d.line(pts,fill=(80,115,95),width=max(4,int(6*s)),joint="curve")
            mx=sum(p[0] for p in pts)/len(pts); my=sum(p[1] for p in pts)/len(pts)
            d.text((mx,my),item["label"].upper(),font=font(10,True),fill=(35,75,55),anchor="mm")
        elif item.get("kind")=="keep_clear":
            off=float(item.get("offset_from_building_ft",12))
            dashed_rect(d,(X(-off),Y(72+off),X(72+off),Y(-off)),fillc=(133,26,29),width=2)
            d.text((X(72+off)+5,Y(72+off)+5),item["label"].upper(),font=font(9),fill=(115,25,29))
    # Building footprint.
    d.rectangle((X(0),Y(72),X(72),Y(0)),outline="black",width=6)
    d.text((X(36),Y(36)),"EQUITY UPRISE BUILDING",font=font(16,True),fill=(20,20,20),anchor="mm")
    # Exterior openings.
    for obj in site.get("exterior_openings",[]):
        loc=obj["location"]; facade=loc.get("facade"); seg=None
        if facade=="east": seg=((72,loc["y1"]),(72,loc["y2"]))
        elif facade=="west": seg=((0,loc["y1"]),(0,loc["y2"]))
        elif facade=="north": seg=((loc["x1"],72),(loc["x2"],72))
        elif facade=="south" and "x1" in loc:
            y=loc.get("y",0); seg=((loc["x1"],y),(loc["x2"],y))
        if seg:
            a,b=seg; d.line((X(a[0]),Y(a[1]),X(b[0]),Y(b[1])),fill=(133,26,29),width=8)
            d.text(((X(a[0])+X(b[0]))/2+5,(Y(a[1])+Y(b[1]))/2-12),obj["label"].upper(),font=font(9,True),fill=(115,25,29))
    # Emergency equipment markers.
    for eq in site.get("emergency_equipment",[]):
        loc=eq.get("location_ft")
        if not loc: continue
        x,y=loc["x"],loc["y"]; d.ellipse((X(x)-6,Y(y)-6,X(x)+6,Y(y)+6),fill=(255,255,255),outline=(133,26,29),width=2)
        d.text((X(x)+9,Y(y)-7),eq["label"].upper(),font=font(8),fill=(80,20,22))
    d.text((85,1610),"Site/life-safety simulation reference only — not a permit, fire-protection, civil, or emergency-services plan.",font=font(13),fill=(55,55,55))
    im.save(path)

def site_plan_svg(path):
    W,H=1200,1200; m=105
    sb=site["site_bounds_ft"]; sx=sb["x2"]-sb["x1"]; sy=sb["y2"]-sb["y1"]; s=min((W-2*m)/sx,(H-2*m)/sy)
    X=lambda x:m+(x-sb["x1"])*s
    Y=lambda y:H-m-(y-sb["y1"])*s
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         '<style>.t{font-family:Arial,sans-serif;fill:#111}.small{font-size:8px}.med{font-size:11px}.title{font-size:18px;font-weight:700}.site{stroke:#555;stroke-width:1.2}.egress{stroke:#851A1D;stroke-width:4}.keep{fill:none;stroke:#851A1D;stroke-width:1.5;stroke-dasharray:6 5}.building{fill:none;stroke:#111;stroke-width:4}</style>',
         '<text x="55" y="32" class="t title">EQUITY UPRISE — FLOOR 01 SITE / LIFE-SAFETY SCHEMATIC</text>',
         '<text x="55" y="52" class="t med">LEVEL OF EXIT DISCHARGE · GENERATED FROM floor-01-site-egress.json · NOT FOR CONSTRUCTION</text>']
    colors={"public_way":"#CDCDCD","walk":"#E1E1DA","egress_walk":"#DCE6DF","service":"#D2C8BC","assembly":"#DAE4D2"}
    for item in site.get("site_elements",[]):
        if "bounds_ft" in item:
            b=item["bounds_ft"]; out.append(f'<rect x="{X(b["x1"])}" y="{Y(b["y2"])}" width="{(b["x2"]-b["x1"])*s}" height="{(b["y2"]-b["y1"])*s}" fill="{colors.get(item.get("kind"),"#ECECE8")}" class="site"/>')
            out.append(f'<text x="{(X(b["x1"])+X(b["x2"]))/2}" y="{(Y(b["y1"])+Y(b["y2"]))/2}" text-anchor="middle" dominant-baseline="middle" class="t small">{esc(item["label"].upper())}</text>')
        elif "polyline_ft" in item:
            pts=" ".join(f'{X(x)},{Y(y)}' for x,y in item["polyline_ft"])
            out.append(f'<polyline points="{pts}" fill="none" stroke="#50735F" stroke-width="{max(3,6*s)}"/>')
            pts0=item["polyline_ft"]; mx=sum(x for x,_ in pts0)/len(pts0); my=sum(y for _,y in pts0)/len(pts0)
            out.append(f'<text x="{X(mx)}" y="{Y(my)}" text-anchor="middle" class="t small">{esc(item["label"].upper())}</text>')
        elif item.get("kind")=="keep_clear":
            off=float(item.get("offset_from_building_ft",12))
            out.append(f'<rect x="{X(-off)}" y="{Y(72+off)}" width="{(72+2*off)*s}" height="{(72+2*off)*s}" class="keep"/>')
    out.append(f'<rect x="{X(0)}" y="{Y(72)}" width="{72*s}" height="{72*s}" class="building"/>')
    out.append(f'<text x="{X(36)}" y="{Y(36)}" text-anchor="middle" class="t med">EQUITY UPRISE BUILDING</text>')
    for obj in site.get("exterior_openings",[]):
        loc=obj["location"]; facade=loc.get("facade"); seg=None
        if facade=="east": seg=((72,loc["y1"]),(72,loc["y2"]))
        elif facade=="west": seg=((0,loc["y1"]),(0,loc["y2"]))
        elif facade=="north": seg=((loc["x1"],72),(loc["x2"],72))
        elif facade=="south" and "x1" in loc:
            y=loc.get("y",0); seg=((loc["x1"],y),(loc["x2"],y))
        if seg:
            a,b=seg; out.append(f'<line x1="{X(a[0])}" y1="{Y(a[1])}" x2="{X(b[0])}" y2="{Y(b[1])}" class="egress"/>')
            out.append(f'<text x="{(X(a[0])+X(b[0]))/2+4}" y="{(Y(a[1])+Y(b[1]))/2-6}" class="t small">{esc(obj["label"].upper())}</text>')
    for eq in site.get("emergency_equipment",[]):
        loc=eq.get("location_ft")
        if not loc: continue
        out.append(f'<circle cx="{X(loc["x"])}" cy="{Y(loc["y"])}" r="4" fill="#fff" stroke="#851A1D"/>')
        out.append(f'<text x="{X(loc["x"])+6}" y="{Y(loc["y"])-4}" class="t small">{esc(eq["label"].upper())}</text>')
    out.append('<text x="55" y="1165" class="t med">Simulation reference only — not a permit, civil, fire-protection, or emergency-services plan.</text>')
    out.append('</svg>'); path.write_text("\n".join(out),encoding="utf-8")

def site_plan_dxf(path):
    doc=ezdxf.new("R2010",setup=True); msp=doc.modelspace()
    for name,color in [("SITE",8),("BUILDING",7),("EGRESS",1),("ASSEMBLY",3),("EQUIPMENT",1),("TEXT",7)]:
        if name not in doc.layers: doc.layers.add(name,color=color)
    def rect2(b,layer):
        msp.add_lwpolyline([(b["x1"],b["y1"]),(b["x2"],b["y1"]),(b["x2"],b["y2"]),(b["x1"],b["y2"]),(b["x1"],b["y1"])],dxfattribs={"layer":layer})
    for item in site.get("site_elements",[]):
        if "bounds_ft" in item:
            rect2(item["bounds_ft"],"ASSEMBLY" if item.get("kind")=="assembly" else "SITE")
            b=item["bounds_ft"]; msp.add_text(item["label"].upper(),dxfattribs={"layer":"TEXT","height":0.6}).set_placement(((b["x1"]+b["x2"])/2,(b["y1"]+b["y2"])/2))
        elif "polyline_ft" in item:
            msp.add_lwpolyline(item["polyline_ft"],dxfattribs={"layer":"EGRESS"})
        elif item.get("kind")=="keep_clear":
            off=float(item.get("offset_from_building_ft",12)); rect2({"x1":-off,"y1":-off,"x2":72+off,"y2":72+off},"EGRESS")
    rect2({"x1":0,"y1":0,"x2":72,"y2":72},"BUILDING")
    for obj in site.get("exterior_openings",[]):
        loc=obj["location"]; facade=loc.get("facade"); seg=None
        if facade=="east": seg=((72,loc["y1"]),(72,loc["y2"]))
        elif facade=="west": seg=((0,loc["y1"]),(0,loc["y2"]))
        elif facade=="north": seg=((loc["x1"],72),(loc["x2"],72))
        elif facade=="south" and "x1" in loc:
            y=loc.get("y",0); seg=((loc["x1"],y),(loc["x2"],y))
        if seg:
            a,b=seg; msp.add_line(a,b,dxfattribs={"layer":"EGRESS"}); msp.add_text(obj["label"].upper(),dxfattribs={"layer":"TEXT","height":0.5}).set_placement(((a[0]+b[0])/2,(a[1]+b[1])/2))
    for eq in site.get("emergency_equipment",[]):
        loc=eq.get("location_ft")
        if not loc: continue
        msp.add_circle((loc["x"],loc["y"]),0.45,dxfattribs={"layer":"EQUIPMENT"})
        msp.add_text(eq["label"].upper(),dxfattribs={"layer":"TEXT","height":0.45}).set_placement((loc["x"]+0.7,loc["y"]))
    msp.add_text("FLOOR 01 SITE / LIFE-SAFETY SCHEMATIC - NOT FOR CONSTRUCTION",dxfattribs={"layer":"TEXT","height":0.9}).set_placement((-30,104))
    doc.saveas(path)


manifest=[]
for level in plan_levels:
    n=level["level"];d=ref_dir(level);d.mkdir(parents=True,exist_ok=True);base=OUT_NAMES[n]
    paths={"png":d/f"{base}.png","svg":d/f"{base}.svg","dxf":d/f"{base}.dxf"}
    png(level,paths["png"]);svg(level,paths["svg"]);dxf(level,paths["dxf"])
    row={
        "level":n,
        "title":level["title"],
        "elevation_ft":level["elevation_ft"],
        "design_maturity":level.get("design_maturity","support-level" if level.get("basement") else None),
        "render_readiness":level.get("render_readiness"),
        "files":{k:str(v.relative_to(BUILDING)) for k,v in paths.items()}
    }
    if n==1:
        site_paths={"png":d/f"{SITE_OUT_NAME}.png","svg":d/f"{SITE_OUT_NAME}.svg","dxf":d/f"{SITE_OUT_NAME}.dxf"}
        site_plan_png(site_paths["png"]);site_plan_svg(site_paths["svg"]);site_plan_dxf(site_paths["dxf"])
        row["site_plan_files"]={k:str(v.relative_to(BUILDING)) for k,v in site_paths.items()}
        row["site_plan_authority"]="production/floor-01/floor-01-site-egress.json"
    (d/"README.md").write_text(plan_readme(level,base))
    manifest.append(row)

# contact sheet
ims=[Image.open(ref_dir(x)/f"{OUT_NAMES[x['level']]}.png").resize((400,420)) for x in plan_levels]
sheet=Image.new("RGB",(1200,1260),"white")
for i,im in enumerate(ims):sheet.paste(im,((i%3)*400,(i//3)*420))
sheet.save(REFS/"equity-uprise-core-v2-plan-contact-sheet.png")
(REFS/"core-v2-plan-generation-manifest.json").write_text(json.dumps(manifest,indent=2))
print("Generated Core V2 plan references for B1 and levels 1–7")
