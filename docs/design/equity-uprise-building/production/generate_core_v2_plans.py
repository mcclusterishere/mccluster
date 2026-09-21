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
import json, math, textwrap, uuid
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
SITE_DIR=REFS/"floor-01-site"
SITE_BASE="equity-uprise-floor-01-site-egress-core-v2-schematic-v1"

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

def plan_readme(level,base):
    label="Basement B1" if level.get("basement") else f"Floor {level['level']:02d}"
    if level.get("basement"):
        status="RESTRICTED CORE V2 PLAN REFERENCE"
    elif level.get("design_maturity")=="reconciled-current-iterative-pass":
        status="ACTIVE CORE V2 PLAN REFERENCE"
    else:
        status="PROVISIONAL CORE V2 CHASSIS PLAN — PROGRAM PRE-ITERATIVE"
    authority="basement-b1-program.json" if level.get("basement") else "core-v2-floor-programs.json"
    return f"""# {label} — {level['title']} — Core V2 Plan References

> Status: **{status} / NOT FOR CONSTRUCTION**

Generated from:
- `production/building-core-v2.json`
- `production/{authority}`
- `production/generate_core_v2_plans.py`

Files:
- `{base}.dxf`
- `{base}.svg`
- `{base}.png`

Finished-floor elevation: **{elev_label(level['elevation_ft'])}**.

These files are **generated-only**. Do not hand-edit them or treat this README as geometry authority.

The machine-readable source files above control title, level identity, program zones, shared vertical systems, and regeneration.

Design maturity: **{level.get('design_maturity','support-level' if level.get('basement') else 'unspecified')}**.
"""

def normalize_dxf_metadata(path, level):
    """Normalize ezdxf run-specific header fields so generated DXF bytes are reproducible."""
    seed=f"equity-uprise-core-v2-level-{level['level']}"
    replacements={
      "$TDCREATE":"2451544.5",
      "$TDUPDATE":"2451544.5",
      "$TDUCREATE":"2451544.5",
      "$TDUUPDATE":"2451544.5",
      "$FINGERPRINTGUID":"{"+str(uuid.uuid5(uuid.NAMESPACE_URL,seed+"-fingerprint")).upper()+"}",
      "$VERSIONGUID":"{"+str(uuid.uuid5(uuid.NAMESPACE_URL,seed+"-version")).upper()+"}",
    }
    lines=path.read_text(encoding="utf-8",errors="strict").splitlines()
    stamp_prefix=f"{ezdxf.__version__} @ "
    for i,line in enumerate(lines):
        key=line.strip()
        if key in replacements and i+2 < len(lines):
            lines[i+2]=replacements[key]
        elif key.startswith(stamp_prefix):
            indent=line[:len(line)-len(line.lstrip())]
            lines[i]=indent+stamp_prefix+"2000-01-01T00:00:00+00:00"
    path.write_text("\n".join(lines)+"\n",encoding="utf-8",newline="\n")

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
    normalize_dxf_metadata(path,level)

def site_xy():
    sb=site["site_bounds_ft"]
    return sb["x1"],sb["y1"],sb["x2"],sb["y2"]

def site_png(path):
    W,H=1800,1800;m=170;top=120;bottom=170
    x0,y0,x1,y1=site_xy();s=min((W-2*m)/(x1-x0),(H-top-bottom)/(y1-y0))
    X=lambda x:m+(x-x0)*s;Y=lambda y:top+(y1-y)*s
    im=Image.new("RGB",(W,H),"white");d=ImageDraw.Draw(im)
    d.text((90,38),"EQUITY UPRISE — FLOOR 01 SITE / EXIT DISCHARGE",font=font(30,True),fill="black")
    d.text((90,82),"CORE V2 SITE / EGRESS SIMULATION PLAN · NOT FOR CONSTRUCTION",font=font(18),fill=(55,55,55))
    colors={"public_way":"#d3d5d6","walk":"#e8e8e3","egress_walk":"#e8e8e3","service":"#d7cdc1","assembly":"#dde4d7"}
    for item in site.get("site_elements",[]):
        kind=item.get("kind","site")
        if "bounds_ft" in item:
            b=item["bounds_ft"];rect=(X(b["x1"]),Y(b["y2"]),X(b["x2"]),Y(b["y1"]))
            d.rectangle(rect,fill=colors.get(kind,"#eeeeea"),outline=(70,70,70),width=2)
            d.text(((rect[0]+rect[2])/2,(rect[1]+rect[3])/2),item["label"],font=font(12,True),fill=(25,25,25),anchor="mm")
        elif "polyline_ft" in item:
            pts=[(X(p[0]),Y(p[1])) for p in item["polyline_ft"]]
            d.line(pts,fill=(80,80,80),width=6,joint="curve")
            mid=pts[len(pts)//2];d.text(mid,item["label"],font=font(11,True),fill=(25,25,25),anchor="mm")
        elif kind=="keep_clear":
            b=site["building_bounds_ft"];off=item.get("offset_from_building_ft",0)
            d.rectangle((X(b["x1"]-off),Y(b["y2"]+off),X(b["x2"]+off),Y(b["y1"]-off)),outline=(145,45,45),width=3)
    b=site["building_bounds_ft"];d.rectangle((X(b["x1"]),Y(b["y2"]),X(b["x2"]),Y(b["y1"])),outline="black",width=6)
    d.text((X(36),Y(36)),"EQUITY UPRISE\nFLOOR 1 FOOTPRINT",font=font(18,True),fill=(20,20,20),anchor="mm",align="center")
    for obj in site.get("exterior_openings",[]):
        loc=obj["location"];fac=loc.get("facade")
        if fac in ("north","south"):
            yy=72 if fac=="north" else loc.get("y",0);a=(X(loc["x1"]),Y(yy));b2=(X(loc["x2"]),Y(yy))
        else:
            xx=72 if fac=="east" else 0;a=(X(xx),Y(loc["y1"]));b2=(X(xx),Y(loc["y2"]))
        d.line((a,b2),fill=(145,30,35),width=7)
        d.text(((a[0]+b2[0])/2,(a[1]+b2[1])/2-10),obj["label"],font=font(9,True),fill=(120,25,30),anchor="ms")
    for eq in site.get("emergency_equipment",[]):
        p=eq["location_ft"];cx,cy=X(p["x"]),Y(p["y"])
        d.ellipse((cx-6,cy-6,cx+6,cy+6),fill=(133,26,29),outline="white",width=1)
        d.text((cx+8,cy),eq["label"],font=font(9),fill=(80,20,25),anchor="lm")
    d.text((90,H-120),"Public/accessible approach · protected-stair discharge · secure service access · emergency equipment · two assembly areas",font=font(13),fill=(50,50,50))
    d.text((90,H-88),"Simulation planning only — not a permit/site-plan or code-compliance claim.",font=font(13,True),fill=(90,30,30))
    im.save(path)

def site_svg(path):
    W,H=1100,1120;m=90;top=90;bottom=120
    x0,y0,x1,y1=site_xy();s=min((W-2*m)/(x1-x0),(H-top-bottom)/(y1-y0))
    X=lambda x:m+(x-x0)*s;Y=lambda y:top+(y1-y)*s
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         '<style>.t{font-family:Arial,sans-serif;fill:#111}.small{font-size:8px}.med{font-size:10px}.title{font-size:18px;font-weight:700}.site{stroke:#555;stroke-width:1.5}.bldg{fill:none;stroke:#111;stroke-width:4}.door{stroke:#851a1d;stroke-width:5}.equip{fill:#851a1d;stroke:#fff;stroke-width:1}</style>',
         '<text x="45" y="30" class="t title">EQUITY UPRISE — FLOOR 01 SITE / EXIT DISCHARGE</text>',
         '<text x="45" y="50" class="t med">CORE V2 SITE / EGRESS SIMULATION PLAN · NOT FOR CONSTRUCTION</text>']
    colors={"public_way":"#d3d5d6","walk":"#e8e8e3","egress_walk":"#e8e8e3","service":"#d7cdc1","assembly":"#dde4d7"}
    for item in site.get("site_elements",[]):
        kind=item.get("kind","site")
        if "bounds_ft" in item:
            b=item["bounds_ft"];out.append(f'<rect x="{X(b["x1"])}" y="{Y(b["y2"])}" width="{(b["x2"]-b["x1"])*s}" height="{(b["y2"]-b["y1"])*s}" fill="{colors.get(kind,"#eeeeea")}" class="site"/>')
            out.append(f'<text x="{(X(b["x1"])+X(b["x2"]))/2}" y="{(Y(b["y1"])+Y(b["y2"]))/2}" text-anchor="middle" dominant-baseline="middle" class="t small">{esc(item["label"].upper())}</text>')
        elif "polyline_ft" in item:
            pts=" ".join(f'{X(p[0])},{Y(p[1])}' for p in item["polyline_ft"]);out.append(f'<polyline points="{pts}" fill="none" stroke="#666" stroke-width="6"/>')
            p=item["polyline_ft"][len(item["polyline_ft"])//2];out.append(f'<text x="{X(p[0])}" y="{Y(p[1])}" text-anchor="middle" class="t small">{esc(item["label"].upper())}</text>')
        elif kind=="keep_clear":
            b=site["building_bounds_ft"];off=item.get("offset_from_building_ft",0)
            out.append(f'<rect x="{X(b["x1"]-off)}" y="{Y(b["y2"]+off)}" width="{(b["x2"]-b["x1"]+2*off)*s}" height="{(b["y2"]-b["y1"]+2*off)*s}" fill="none" stroke="#8a1f23" stroke-width="2" stroke-dasharray="6 5"/>')
            out.append(f'<text x="{X(b["x2"]+off)-4}" y="{Y(b["y2"]+off)+12}" text-anchor="end" class="t small">{esc(item["label"].upper())}</text>')
    b=site["building_bounds_ft"];out.append(f'<rect x="{X(b["x1"])}" y="{Y(b["y2"])}" width="{(b["x2"]-b["x1"])*s}" height="{(b["y2"]-b["y1"])*s}" class="bldg"/>')
    out.append(f'<text x="{X(36)}" y="{Y(36)}" text-anchor="middle" class="t med">EQUITY UPRISE FLOOR 1 FOOTPRINT</text>')
    for obj in site.get("exterior_openings",[]):
        loc=obj["location"];fac=loc.get("facade")
        if fac in ("north","south"):
            yy=72 if fac=="north" else loc.get("y",0);x1d,x2d=X(loc["x1"]),X(loc["x2"]);y=Y(yy);out.append(f'<line x1="{x1d}" y1="{y}" x2="{x2d}" y2="{y}" class="door"/>');tx=(x1d+x2d)/2;ty=y-7
        else:
            xx=72 if fac=="east" else 0;y1d,y2d=Y(loc["y1"]),Y(loc["y2"]);x=X(xx);out.append(f'<line x1="{x}" y1="{y1d}" x2="{x}" y2="{y2d}" class="door"/>');tx=x+7;ty=(y1d+y2d)/2
        out.append(f'<text x="{tx}" y="{ty}" class="t small">{esc(obj["label"].upper())}</text>')
    for eq in site.get("emergency_equipment",[]):
        p=eq["location_ft"];out.append(f'<circle cx="{X(p["x"])}" cy="{Y(p["y"])}" r="4" class="equip"/>');out.append(f'<text x="{X(p["x"])+7}" y="{Y(p["y"])+3}" class="t small">{esc(eq["label"].upper())}</text>')
    out += ['<text x="45" y="1070" class="t med">Generated-only site / egress simulation authority · not a permit/site-plan.</text>','</svg>']
    path.write_text("\n".join(out),encoding="utf-8")

def site_dxf(path):
    doc=ezdxf.new("R2010",setup=True);msp=doc.modelspace()
    for name,color in [("SITE",8),("BUILDING",7),("EGRESS",3),("DOORS",1),("EQUIPMENT",1),("TEXT",7)]:
        if name not in doc.layers:doc.layers.add(name,color=color)
    def rect2(b,layer):
        msp.add_lwpolyline([(b["x1"],b["y1"]),(b["x2"],b["y1"]),(b["x2"],b["y2"]),(b["x1"],b["y2"]),(b["x1"],b["y1"])],dxfattribs={"layer":layer})
    for item in site.get("site_elements",[]):
        if "bounds_ft" in item:
            rect2(item["bounds_ft"],"EGRESS" if item.get("kind") in ("walk","egress_walk","assembly") else "SITE")
            b=item["bounds_ft"];msp.add_text(item["label"].upper(),dxfattribs={"layer":"TEXT","height":0.8}).set_placement(((b["x1"]+b["x2"])/2,(b["y1"]+b["y2"])/2))
        elif "polyline_ft" in item:
            msp.add_lwpolyline(item["polyline_ft"],dxfattribs={"layer":"EGRESS"});p=item["polyline_ft"][len(item["polyline_ft"])//2];msp.add_text(item["label"].upper(),dxfattribs={"layer":"TEXT","height":0.8}).set_placement(tuple(p))
        elif item.get("kind")=="keep_clear":
            b=site["building_bounds_ft"];off=item.get("offset_from_building_ft",0)
            kb={"x1":b["x1"]-off,"y1":b["y1"]-off,"x2":b["x2"]+off,"y2":b["y2"]+off}
            rect2(kb,"EGRESS")
            msp.add_text(item["label"].upper(),dxfattribs={"layer":"TEXT","height":0.8}).set_placement((kb["x2"]-18,kb["y2"]-2))
    rect2(site["building_bounds_ft"],"BUILDING")
    for obj in site.get("exterior_openings",[]):
        loc=obj["location"];fac=loc.get("facade")
        if fac in ("north","south"):
            yy=72 if fac=="north" else loc.get("y",0);a=(loc["x1"],yy);b=(loc["x2"],yy)
        else:
            xx=72 if fac=="east" else 0;a=(xx,loc["y1"]);b=(xx,loc["y2"])
        msp.add_line(a,b,dxfattribs={"layer":"DOORS"});msp.add_text(obj["label"].upper(),dxfattribs={"layer":"TEXT","height":0.55}).set_placement(((a[0]+b[0])/2,(a[1]+b[1])/2))
    for eq in site.get("emergency_equipment",[]):
        p=eq["location_ft"];msp.add_circle((p["x"],p["y"]),0.4,dxfattribs={"layer":"EQUIPMENT"});msp.add_text(eq["label"].upper(),dxfattribs={"layer":"TEXT","height":0.45}).set_placement((p["x"]+.6,p["y"]))
    msp.add_text("EQUITY UPRISE FLOOR 01 SITE / EXIT DISCHARGE · NOT FOR CONSTRUCTION",dxfattribs={"layer":"TEXT","height":1.0}).set_placement((site["site_bounds_ft"]["x1"],site["site_bounds_ft"]["y2"]+4))
    doc.saveas(path)
    normalize_dxf_metadata(path,{"level":"01-site"})

manifest=[]
for level in plan_levels:
    n=level["level"];d=ref_dir(level);d.mkdir(parents=True,exist_ok=True);base=OUT_NAMES[n]
    paths={"png":d/f"{base}.png","svg":d/f"{base}.svg","dxf":d/f"{base}.dxf"}
    png(level,paths["png"]);svg(level,paths["svg"]);dxf(level,paths["dxf"])
    (d/"README.md").write_text(plan_readme(level,base))
    manifest.append({
        "level":n,
        "title":level["title"],
        "elevation_ft":level["elevation_ft"],
        "design_maturity":level.get("design_maturity","support-level" if level.get("basement") else None),
        "render_readiness":level.get("render_readiness"),
        "files":{k:str(v.relative_to(BUILDING)) for k,v in paths.items()}
    })

SITE_DIR.mkdir(parents=True,exist_ok=True)
site_paths={"png":SITE_DIR/f"{SITE_BASE}.png","svg":SITE_DIR/f"{SITE_BASE}.svg","dxf":SITE_DIR/f"{SITE_BASE}.dxf"}
site_png(site_paths["png"]);site_svg(site_paths["svg"]);site_dxf(site_paths["dxf"])
(SITE_DIR/"README.md").write_text("""# Floor 01 — Site / Exit-Discharge — Core V2 Plan References

> Status: **ACTIVE GENERATED SITE / EGRESS REFERENCE / NOT FOR CONSTRUCTION**

Generated from `production/floor-01/floor-01-site-egress.json` and `production/building-core-v2.json`.

Files:
- `equity-uprise-floor-01-site-egress-core-v2-schematic-v1.dxf`
- `equity-uprise-floor-01-site-egress-core-v2-schematic-v1.svg`
- `equity-uprise-floor-01-site-egress-core-v2-schematic-v1.png`

Generated-only. This complements the Floor 1 interior plan and never overrides canonical JSON authority.
""")
(SITE_DIR/"floor-01-site-plan-generation-manifest.json").write_text(json.dumps({"schema_version":"1.0.0","source":"production/floor-01/floor-01-site-egress.json","files":{k:str(v.relative_to(BUILDING)) for k,v in site_paths.items()},"not_for_construction":True},indent=2)+"\n")

# contact sheet
ims=[Image.open(ref_dir(x)/f"{OUT_NAMES[x['level']]}.png").resize((400,420)) for x in plan_levels]
sheet=Image.new("RGB",(1200,1260),"white")
for i,im in enumerate(ims):sheet.paste(im,((i%3)*400,(i//3)*420))
sheet.save(REFS/"equity-uprise-core-v2-plan-contact-sheet.png")
(REFS/"core-v2-plan-generation-manifest.json").write_text(json.dumps(manifest,indent=2))
print("Generated Core V2 plan references for B1, levels 1–7, and Floor 1 site/egress")
