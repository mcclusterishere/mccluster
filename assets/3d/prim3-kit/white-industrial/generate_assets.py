#!/usr/bin/env python3
"""PRIM3 White Industrial kit: deterministic, dependency-free glTF 2.0 export.

All positions use game units, +Y up. Assets are centered on X/Z and have a
bottom-center origin. Geometry is merged by material to keep draw calls small.
Run: python3 generate_assets.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parent
MATERIALS = {
    "white": ([0.89, 0.91, 0.90, 1], 0.12, 0.70),
    "ivory": ([0.82, 0.83, 0.78, 1], 0.0, 0.89),
    "porcelain": ([0.98, 0.98, 0.95, 1], 0.08, 0.42),
    "seam": ([0.39, 0.44, 0.44, 1], 0.25, 0.75),
    "glass": ([0.28, 0.37, 0.39, 1], 0.3, 0.22),
    "water": ([0.055, 0.31, 0.33, 1], 0.1, 0.22),
    "ripple": ([0.15, 0.45, 0.45, 1], 0.08, 0.28),
    "soil": ([0.30, 0.20, 0.12, 1], 0.0, 1.0),
    "earth": ([0.44, 0.32, 0.19, 1], 0.0, 1.0),
    "grass": ([0.22, 0.37, 0.13, 1], 0.0, 1.0),
    "leaf": ([0.16, 0.31, 0.10, 1], 0.0, 1.0),
    "leaflight": ([0.31, 0.43, 0.13, 1], 0.0, 1.0),
    "bark": ([0.27, 0.18, 0.11, 1], 0.0, 1.0),
    "stone": ([0.47, 0.49, 0.42, 1], 0.0, 0.94),
    "signal": ([0.10, 0.63, 0.62, 1], 0.1, 0.35),
}


def add(a, b): return tuple(x + y for x, y in zip(a, b))
def sub(a, b): return tuple(x - y for x, y in zip(a, b))
def mul(a, s): return tuple(x * s for x in a)
def dot(a, b): return sum(x * y for x, y in zip(a, b))
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def normal(v):
    d = math.sqrt(dot(v, v))
    return mul(v, 1 / d) if d else (0, 1, 0)


class Mesh:
    def __init__(self):
        self.groups = {}
        self.parts = []

    def part(self, shape, center, size, material, rotation=(0,0,0)):
        rgb = MATERIALS[material][0][:3]
        self.parts.append({"shape":shape,"x":center[0],"y":center[1],"z":center[2],
                           "w":size[0],"h":size[1],"d":size[2],
                           "color":"#"+"".join(f"{round(v*255):02x}" for v in rgb),"r":list(rotation),"material":material})

    def face(self, points, material="white"):
        g = self.groups.setdefault(material, {"p": [], "n": [], "i": []})
        offset = len(g["p"]) // 3
        n = normal(cross(sub(points[1], points[0]), sub(points[2], points[0])))
        for p in points:
            g["p"].extend(p)
            g["n"].extend(n)
        for k in range(1, len(points)-1):
            g["i"].extend([offset, offset+k, offset+k+1])

    def box(self, center, size, material="white", yaw=0):
        self.part("box",center,size,material,(0,yaw,0))
        x, y, z = (v / 2 for v in size)
        p = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),
             (-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
        c, s = math.cos(yaw), math.sin(yaw)
        p = [add((a*c+d*s,b,-a*s+d*c), center) for a,b,d in p]
        for f in [(3,2,1,0),(4,5,6,7),(0,4,7,3),(2,6,5,1),(7,6,2,3),(0,1,5,4)]:
            self.face([p[j] for j in f], material)

    def cylinder(self, start, end, radius, material="white", segments=10):
        axis = normal(sub(end, start))
        length=math.sqrt(dot(sub(end,start),sub(end,start)))
        self.part("cylinder",mul(add(start,end),.5),(radius*2,length,radius*2),material,
                  (math.asin(max(-1,min(1,axis[2]))),0,math.atan2(-axis[0],axis[1])))
        seed = (0,1,0) if abs(axis[1]) < .95 else (1,0,0)
        u = normal(cross(seed, axis)); v = cross(axis, u)
        rings=[]
        for center in (start,end):
            rings.append([add(center, add(mul(u,radius*math.cos(2*math.pi*j/segments)), mul(v,radius*math.sin(2*math.pi*j/segments)))) for j in range(segments)])
        for j in range(segments):
            k=(j+1)%segments
            self.face([rings[0][j],rings[0][k],rings[1][k],rings[1][j]], material)
        self.face(list(reversed(rings[0])),material)
        self.face(rings[1],material)

    def ellipsoid(self, center, radii, material="leaf", sides=10, bands=6):
        self.part("sphere",center,mul(radii,2),material)
        rings=[]
        # Offset poles very slightly to avoid zero-area triangles.
        for j in range(bands+1):
            phi=math.pi*(.0001+(j/bands)*.9998)
            rings.append([add(center,(radii[0]*math.sin(phi)*math.cos(i*2*math.pi/sides),radii[1]*math.cos(phi),radii[2]*math.sin(phi)*math.sin(i*2*math.pi/sides))) for i in range(sides)])
        for j in range(bands):
            for i in range(sides):
                k=(i+1)%sides
                self.face([rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i]],material)

    def railing(self, x1,z1,x2,z2,base=0,height=1.1,spacing=2.0):
        length=math.hypot(x2-x1,z2-z1)
        n=max(1,math.ceil(length/spacing))
        for i in range(n+1):
            a=i/n; x=x1+(x2-x1)*a; z=z1+(z2-z1)*a
            self.cylinder((x,base,z),(x,base+height,z),.065)
        for h in (.48*height,height):
            self.cylinder((x1,base+h,z1),(x2,base+h,z2),.055)

    def ring(self,radius,y,material="white",segments=32,tube=.07):
        for i in range(segments):
            a=i*2*math.pi/segments; b=(i+1)*2*math.pi/segments
            self.cylinder((math.cos(a)*radius,y,math.sin(a)*radius),(math.cos(b)*radius,y,math.sin(b)*radius),tube,material,6)

    def bounds(self):
        verts=[tuple(g["p"][i:i+3]) for g in self.groups.values() for i in range(0,len(g["p"]),3)]
        return [[min(v[i] for v in verts) for i in range(3)],[max(v[i] for v in verts) for i in range(3)]]

    def recenter(self):
        b=self.bounds(); offset=(-(b[0][0]+b[1][0])/2,-b[0][1],-(b[0][2]+b[1][2])/2)
        for g in self.groups.values():
            for i in range(0,len(g["p"]),3):
                for j in range(3): g["p"][i+j]+=offset[j]
        for p in self.parts:
            for j,k in enumerate(("x","y","z")):p[k]+=offset[j]


def panel_lines(m, width, depth, height, step=2):
    for x in range(-int(width/2)+2,int(width/2),step):
        m.box((x,height/2,-depth/2-.012),(.025,height,.022),"seam")
        m.box((x,height/2,depth/2+.012),(.025,height,.022),"seam")


def rooftop(m,width,depth,y):
    m.box((0,y-.1,0),(width,.2,depth),"porcelain")
    for z in (-depth/2+.15,depth/2-.15): m.box((0,y+.3,z),(width,.6,.3))
    for x in (-width/2+.15,width/2-.15): m.box((x,y+.3,0),(.3,.6,depth))


def hvac(m,x,y,z,w=2.5,d=2.2,h=1.1):
    m.box((x,y+h/2,z),(w,h,d),"white")
    m.box((x,y+h+.04,z),(w+.05,.08,d+.05),"porcelain")
    for dx in (-w*.24,w*.24):
        m.cylinder((x+dx,y+h+.08,z),(x+dx,y+h+.13,z),min(w*.21,d*.38),"seam",16)
        for a in (0,math.pi/2):
            m.box((x+dx,y+h+.15,z),(w*.34,.025,.075),"white",a)
    for j in range(5): m.box((x,y+.2+j*.16,z+d/2+.015),(w*.85,.035,.03),"seam")


def make_asset(asset_id):
    m=Mesh()
    if asset_id in ("concrete-tile-8","soil-tile-8","grass-tile-8"):
        mat={"concrete-tile-8":"ivory","soil-tile-8":"soil","grass-tile-8":"grass"}[asset_id]
        m.box((0,.09,0),(8,.18,8),mat)
        if asset_id=="concrete-tile-8":
            for x in (-2,0,2): m.box((x,.185,0),(.025,.01,7.98),"seam")
            for z in (-2,0,2): m.box((0,.185,z),(7.98,.01,.025),"seam")
        elif asset_id=="soil-tile-8":
            for i in range(13):
                x=((i*1.73)%7)-3.5;z=((i*2.39)%7)-3.5
                m.ellipsoid((x,.19,z),(.13+.02*(i%3),.04,.1),"earth",6,3)
        else:
            for i in range(36):
                x=((i*1.23)%7.4)-3.7; z=((i*2.37)%7.4)-3.7
                m.box((x,.23,z),(.025,.15,.025),"leaflight")
    elif asset_id=="water-tile-16":
        m.box((0,.06,0),(16,.12,8),"water")
        for i in range(12):
            x=((i*2.37)%13)-6.5;z=((i*1.67)%7)-3.5
            m.box((x,.124,z),(.5+(i%4)*.35,.008,.025),"ripple",.18)
    elif asset_id=="warehouse-16":
        m.box((0,4,0),(16,8,12),"ivory")
        rooftop(m,16,12,8)
        panel_lines(m,16,12,7.8)
        for z in (-6.024,6.024):
            for x in (-6,-3,0,3,6):
                m.box((x,5.4,z),(1.8,.75,.04),"glass")
                m.box((x,5.4,z),(1.88,.06,.08),"white")
                m.box((x,5.4,z),(.07,.8,.08),"white")
        m.box((-3,1.65,-6.055),(3.4,3.3,.12),"porcelain")
        for y in (.4,.8,1.2,1.6,2,2.4,2.8,3.2): m.box((-3,y,-6.122),(3.2,.025,.015),"seam")
        m.box((4.8,1.25,-6.055),(1.5,2.5,.12),"white")
        m.box((5.24,1.25,-6.14),(.06,.3,.08),"seam")
        hvac(m,3,8,-1,w=3.6,d=2.8,h=.83)
        m.cylinder((-5,8,3),(-5,9,3),.27,"white",12)
    elif asset_id=="tower-8":
        m.box((0,6,0),(8,12,8),"ivory")
        rooftop(m,8,8,12)
        panel_lines(m,8,8,12)
        for y in (2.8,6,9.2):
            for z in (-4.025,4.025):
                for x in (-2.5,0,2.5): m.box((x,y,z),(1.2,1.0,.05),"glass")
            m.box((0,y-1.1,0),(8.05,.12,8.05),"white")
    elif asset_id=="wall-8":
        m.box((0,1.5,0),(8,3,.6),"ivory")
        m.box((0,3.07,0),(8,.14,.7),"porcelain")
        for x in (-3.9,0,3.9):m.box((x,1.5,0),(.15,3,.75),"white")
    elif asset_id=="low-barrier-4":
        m.box((0,.15,0),(4,.3,1),"ivory")
        m.box((0,.7,0),(3.8,.8,.6),"white")
        m.box((0,1.13,0),(3.8,.06,.65),"porcelain")
        for x in (-1.4,1.4):m.box((x,.45,0),(.18,.6,.82),"porcelain")
    elif asset_id=="high-cover-4":
        m.box((0,1.3,0),(4,2.6,1.1),"white")
        m.box((0,2.65,0),(4.05,.1,1.15),"porcelain")
        for x in (-1.7,0,1.7):m.box((x,1.3,.565),(.05,2.4,.03),"seam")
        for x in (-1.5,1.5):m.box((x,.1,0),(.5,.2,1.5),"ivory")
    elif asset_id=="container-12":
        m.box((0,2,0),(12,4,4),"white")
        for x in [i*.5-5.5 for i in range(23)]:
            for z in (-2.04,2.04):m.box((x,2,z),(.1,3.6,.08),"porcelain")
        for x in (-6.04,6.04):
            m.box((x,2,0),(.08,3.65,.035),"seam")
            for z in (-1.8,1.8,-.35,.35):m.cylinder((x,0.3,z),(x,3.7,z),.045)
        for z in (-1.9,1.9):
            for y in (.12,3.88):m.box((0,y,z),(12.12,.24,.24),"porcelain")
    elif asset_id=="crate-2":
        m.box((0,1,0),(2,2,2),"ivory")
        for a in (-.85,.85):
            m.box((a,1,0),(.2,2.06,2.06),"white")
            m.box((0,1,a),(2.06,2.06,.2),"white")
        for y in (.15,1.85):m.box((0,y,0),(2.1,.2,2.1),"porcelain")
        m.box((0,1,-1.06),(.65,.4,.04),"white")
    elif asset_id=="bridge-16":
        m.box((0,.15,0),(16,.3,6),"white")
        for x in [i-7.5 for i in range(16)]:m.box((x,.295,0),(.025,.01,5.8),"seam")
        m.railing(-7.9,-2.85,7.9,-2.85,base=.3)
        m.railing(-7.9,2.85,7.9,2.85,base=.3)
        for x in (-7.4,7.4):m.box((x,.15,0),(.5,.3,6.12),"ivory")
    elif asset_id=="stairs-8":
        for i in range(16):
            z=-4+(i+.5)*.5; height=(i+1)*.5
            m.box((0,height/2,z),(4,height,.5),"ivory")
            m.box((0,height-.015,z-.21),(3.9,.03,.06),"porcelain")
        for x in (-1.94,1.94):
            for i in range(0,16,3):
                z=-4+(i+.5)*.5;h=(i+1)*.5
                m.cylinder((x,h,z),(x,h+1.05,z),.055)
            m.cylinder((x,1.55,-3.75),(x,9.05,3.75),.06)
    elif asset_id=="catwalk-8":
        m.box((0,3.85,0),(8,.3,4),"white")
        for x in (-3.7,3.7):
            for z in (-1.7,1.7):m.box((x,1.95,z),(.25,3.9,.25),"white")
        for x in [i*.5-3.75 for i in range(16)]:m.box((x,3.995,0),(.025,.01,3.6),"seam")
        m.railing(-3.85,-1.85,3.85,-1.85,4)
        m.railing(-3.85,1.85,3.85,1.85,4)
    elif asset_id=="ladder-8":
        for x in (-.45,.45):m.cylinder((x,0,0),(x,8,0),.06)
        for i in range(20):m.cylinder((-.45,.25+i*.39,0),(.45,.25+i*.39,0),.055)
        for y in (.5,3.5,7):
            for x in (-.45,.45):m.box((x,y,.15),(.12,.12,.3),"white")
    elif asset_id=="pipe-stack-6":
        for x,y in ((-.8,.55),(0,.55),(.8,.55),(-.4,1.25),(.4,1.25)):
            m.cylinder((x,y,-3),(x,y,3),.38,"white",12)
            for z in (-3.01,3.01):m.cylinder((x,y,z),(x,y,z+.015),.28,"seam",12)
        for z in (-2,2):m.box((0,.12,z),(2.6,.24,.45),"ivory")
    elif asset_id=="hvac-3":
        hvac(m,0,0,0,w=3,d=2.4,h=1.6)
    elif asset_id=="relay-terminal":
        m.box((0,.12,0),(1.8,.24,1.6),"ivory")
        m.box((0,.95,0),(1.2,1.7,1.0),"white")
        m.box((0,1.95,0),(1.5,.3,1.25),"porcelain")
        m.box((0,1.58,-.511),(.75,.45,.025),"glass")
        m.box((0,1.65,-.532),(.6,.035,.02),"signal")
        m.cylinder((.42,2.1,.3),(.42,3.4,.3),.035)
        for y in (2.75,3.15):m.cylinder((.1,y,.3),(.74,y,.3),.025)
        for y in (.5,.75,1):m.box((0,y,.511),(.75,.05,.025),"seam")
    elif asset_id=="gate-8":
        for x in (-3.85,3.85):m.box((x,2,0),(.3,4,.4),"white")
        m.box((0,3.85,0),(8,.3,.4),"porcelain")
        for x in [i*.5-3.5 for i in range(15)]:m.box((x,1.8,0),(.05,3.5,.1),"white")
        for y in (.3,1.9,3.5):m.box((0,y,0),(7.5,.08,.12),"white")
        m.box((0,1.6,-.12),(.25,.4,.1),"seam")
    elif asset_id=="fence-8":
        for x in (-3.9,0,3.9):m.box((x,1.3,0),(.15,2.6,.15),"white")
        for y in (.2,2.4):m.box((0,y,0),(8,.09,.09),"white")
        for i in range(32):m.box((-3.875+i*.25,1.3,0),(.025,2.2,.025),"white")
        for i in range(8):m.box((0,.35+i*.25,0),(7.8,.025,.025),"white")
    elif asset_id=="tree-8":
        m.cylinder((0,0,0),(.1,5.3,0),.27,"bark",9)
        for i in range(5):
            a=i*2.4
            m.cylinder((0,3.4,0),(math.cos(a)*1.6,5.6+i*.2,math.sin(a)*1.6),.11,"bark",6)
        for x,y,z,rx,ry,rz,mat in [(0,6,0,2.6,2,2.6,"leaf"),(-1.6,5.7,.4,1.7,1.6,1.7,"grass"),(1.3,6.1,-1,1.7,1.6,1.8,"leaflight"),(.6,6.8,1.1,1.7,1.2,1.6,"grass")]:
            m.ellipsoid((x,y,z),(rx,ry,rz),mat,10,6)
    elif asset_id=="rock-cluster":
        for c,r in [((-1,.55,.1),(1.15,.6,.85)),((.5,.8,.1),(1.1,.85,1.15)),((1.4,.35,-.5),(.6,.4,.55))]:
            m.ellipsoid(c,r,"stone",7,4)
    elif asset_id in ("spawn-marker","extraction-marker"):
        radius=1.4 if asset_id=="spawn-marker" else 2.4
        m.ring(radius,.09,"porcelain",32,.065)
        for a in (0,math.pi/2,math.pi,math.pi*1.5):
            m.box((math.cos(a)*radius,.1,math.sin(a)*radius),(.24,.2,.24),"white")
        if asset_id=="spawn-marker":
            m.box((0,.025,0),(.12,.05,1.4),"white")
            m.box((0,.025,0),(1.4,.05,.12),"white")
        else:
            m.ring(radius-.3,.03,"white",32,.035)
    else: raise ValueError(asset_id)
    m.recenter()
    return m


SPECS = [
    ("concrete-tile-8","Concrete paving","Terrain",True,False,"none","Eight-unit white concrete module with expansion joints."),
    ("soil-tile-8","Exposed soil","Terrain",True,False,"none","Natural brown earth with scattered low stones."),
    ("grass-tile-8","Grass patch","Terrain",True,False,"none","Natural green ground cover and short grass tufts."),
    ("water-tile-16","Canal water","Terrain",False,True,"none","Blue-green water segment with subtle ripple geometry."),
    ("warehouse-16","Warehouse","Structures",True,True,"full","White modular warehouse with panel seams, loading door, windows, parapet, vent and rooftop HVAC."),
    ("tower-8","Service tower","Structures",True,True,"full","Twelve-unit white tower with three window rows and a roof parapet."),
    ("wall-8","Security wall","Structures",False,True,"full","Eight-unit solid wall with supports and capped top."),
    ("low-barrier-4","Low barrier","Cover",False,True,"half","White concrete waist-high barrier with reinforced feet."),
    ("high-cover-4","Full-height cover","Cover",False,True,"full","Standing cover panel with broad stabilizing feet."),
    ("container-12","Cargo container","Structures",True,True,"full","White corrugated container with frame rails and end-door hardware."),
    ("crate-2","Supply crate","Cover",False,True,"full","Compact reinforced white supply crate."),
    ("bridge-16","Canal bridge","Traversal",True,False,"half","Sixteen-unit bridge deck with posts and two guardrails."),
    ("stairs-8","Rooftop stairs","Traversal",True,False,"none","Sixteen steps rise eight units with sloped handrails; access from -Z to +Z."),
    ("catwalk-8","Raised catwalk","Traversal",True,False,"half","Eight-unit raised deck at Y 4 with supports and white rails."),
    ("ladder-8","Access ladder","Traversal",True,False,"none","Eight-unit wall ladder with twenty rungs and mounting brackets."),
    ("pipe-stack-6","Stacked pipes","Cover",False,True,"half","Five white utility pipes resting on white support blocks."),
    ("hvac-3","Rooftop HVAC","Props",False,True,"half","Twin-fan equipment cabinet with vent slats."),
    ("relay-terminal","Relay terminal","Objectives",False,True,"half","White relay cabinet with display, antenna and signal light."),
    ("gate-8","Security gate","Structures",False,True,"full","Eight-unit barred gate with structural frame and central latch."),
    ("fence-8","Mesh fence","Structures",False,True,"none","Eight-unit security fence with fine geometric mesh."),
    ("tree-8","Broadleaf tree","Nature",False,True,"half","Natural brown trunk and branches with green faceted canopy."),
    ("rock-cluster","Natural rocks","Nature",False,True,"half","Three irregular low stone forms for natural terrain cover."),
    ("spawn-marker","Squad spawn","Markers",True,False,"none","White in-world authoring marker; gameplay spawn is metadata."),
    ("extraction-marker","Extraction zone","Markers",True,False,"none","White double-ring authoring marker; gameplay extraction is metadata."),
]

FOOTPRINTS = {
    "concrete-tile-8": (8,8), "soil-tile-8": (8,8), "grass-tile-8": (8,8),
    "water-tile-16": (16,8), "warehouse-16": (16,12), "tower-8": (8,8),
    "wall-8": (8,1), "low-barrier-4": (4,1), "high-cover-4": (4,2),
    "container-12": (12,4), "crate-2": (2,2), "bridge-16": (16,6),
    "stairs-8": (4,8), "catwalk-8": (8,4), "ladder-8": (1,.5),
    "pipe-stack-6": (3,6), "hvac-3": (3,2.5), "relay-terminal": (2,2),
    "gate-8": (8,1), "fence-8": (8,.5), "tree-8": (1,1),
    "rock-cluster": (4,2.5), "spawn-marker": (3,3), "extraction-marker": (5,5),
}
SURFACES = {"concrete-tile-8":.18,"soil-tile-8":.18,"grass-tile-8":.18,
            "warehouse-16":8,"tower-8":12,"container-12":4,
            "bridge-16":.3,"catwalk-8":4,"stairs-8":8,
            "ladder-8":8,"spawn-marker":0,"extraction-marker":0}


def export_glb(mesh, path, asset_id):
    binary=bytearray(); views=[]; accessors=[]; primitives=[]; materials=[]
    def accessor(values, kind, component, target):
        while len(binary)%4: binary.append(0)
        offset=len(binary)
        fmt="f" if component==5126 else "I"
        payload=struct.pack("<"+fmt*len(values),*values)
        binary.extend(payload)
        vi=len(views); views.append({"buffer":0,"byteOffset":offset,"byteLength":len(payload),"target":target})
        width=3 if kind=="VEC3" else 1
        obj={"bufferView":vi,"componentType":component,"count":len(values)//width,"type":kind}
        if component==5126:
            obj["min"]=[min(values[j::width]) for j in range(width)]
            obj["max"]=[max(values[j::width]) for j in range(width)]
        accessors.append(obj);return len(accessors)-1
    for material,g in mesh.groups.items():
        color,metal,rough=MATERIALS[material]
        mat={"name":material,"pbrMetallicRoughness":{"baseColorFactor":color,"metallicFactor":metal,"roughnessFactor":rough}}
        if material=="signal":mat["emissiveFactor"]=[.02,.23,.22]
        mi=len(materials);materials.append(mat)
        p=accessor(g["p"],"VEC3",5126,34962)
        n=accessor(g["n"],"VEC3",5126,34962)
        i=accessor(g["i"],"SCALAR",5125,34963)
        primitives.append({"attributes":{"POSITION":p,"NORMAL":n},"indices":i,"material":mi,"mode":4})
    doc={"asset":{"version":"2.0","generator":"PRIM3 White Industrial deterministic mesh generator 1.0"},
         "scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0,"name":asset_id}],
         "meshes":[{"name":asset_id,"primitives":primitives}],"materials":materials,
         "buffers":[{"byteLength":len(binary)}],"bufferViews":views,"accessors":accessors,
         "extras":{"prim3":{"id":asset_id,"version":"1.0.0","units":"game-unit","upAxis":"Y","pivot":"bottom-center","source":"original procedural mesh","rigged":False,"textures":False}}}
    raw=json.dumps(doc,separators=(",",":"),allow_nan=False).encode()
    raw+=b" "*((-len(raw))%4);binary+=b"\0"*((-len(binary))%4)
    data=struct.pack("<III",0x46546C67,2,12+8+len(raw)+8+len(binary))+struct.pack("<II",len(raw),0x4E4F534A)+raw+struct.pack("<II",len(binary),0x004E4942)+binary
    path.write_bytes(data)
    return {"vertices":sum(len(g["p"])//3 for g in mesh.groups.values()),"triangles":sum(len(g["i"])//3 for g in mesh.groups.values()),"drawCalls":len(primitives),"bytes":len(data)}


def validate_glb(path):
    data=path.read_bytes();magic,version,length=struct.unpack_from("<III",data)
    assert magic==0x46546C67 and version==2 and length==len(data)
    n,t=struct.unpack_from("<II",data,12);assert t==0x4E4F534A
    doc=json.loads(data[20:20+n]);bn,bt=struct.unpack_from("<II",data,20+n);assert bt==0x004E4942
    blob=data[28+n:28+n+bn];assert len(blob)==bn
    for v in doc["bufferViews"]:
        assert v["byteOffset"]%4==0 and v["byteOffset"]+v["byteLength"]<=len(blob)
    for p in doc["meshes"][0]["primitives"]:
        pos=doc["accessors"][p["attributes"]["POSITION"]]
        idx=doc["accessors"][p["indices"]];iv=doc["bufferViews"][idx["bufferView"]]
        ids=struct.unpack_from("<"+"I"*idx["count"],blob,iv["byteOffset"])
        assert all(v<pos["count"] for v in ids) and idx["count"]%3==0
        for attr in ("POSITION","NORMAL"):
            a=doc["accessors"][p["attributes"][attr]];v=doc["bufferViews"][a["bufferView"]]
            vals=struct.unpack_from("<"+"f"*(a["count"]*3),blob,v["byteOffset"])
            assert all(math.isfinite(x) for x in vals)
    return True


def main():
    out=ROOT/"models";out.mkdir(exist_ok=True)
    catalog={"schemaVersion":1,"id":"prim3-white-industrial-v1","name":"PRIM3 White Industrial","version":"1.0.0","unit":"game-unit","upAxis":"Y","pivot":"bottom-center","palette":"White manufactured surfaces; natural water, soil and vegetation.","assets":[]}
    for asset_id,name,category,walkable,blocks,cover,description in SPECS:
        mesh=make_asset(asset_id);path=out/(asset_id+".glb")
        stats=export_glb(mesh,path,asset_id);validate_glb(path)
        b=mesh.bounds();w,h,d=[round(b[1][i]-b[0][i],5) for i in range(3)]
        for p in mesh.parts:
            for k in ("x","y","z","w","h","d"):p[k]=round(p[k],6)
            p["r"]=[round(v,6) for v in p["r"]]
        item={"id":asset_id,"name":name,"category":category,"width":w,"depth":d,"height":h,"walkable":walkable,"blocksMovement":blocks,"cover":cover,"model":"models/"+path.name,"description":description,"bounds":[[round(x,5) for x in a] for a in b],"pivot":"bottom-center","statistics":stats,"parts":mesh.parts}
        if asset_id=="stairs-8":item.update(traversalRise=8,entry=[0,0,-4],exit=[0,8,4],surfaceType="stairs")
        item["footprint"]={"width":FOOTPRINTS[asset_id][0],"depth":FOOTPRINTS[asset_id][1]}
        if asset_id in SURFACES:item["surfaceHeight"]=SURFACES[asset_id]
        if asset_id=="catwalk-8":item.update(walkableHeight=4,surfaceType="raised-platform")
        if asset_id=="bridge-16":item.update(walkableHeight=.3,surfaceType="bridge")
        if asset_id=="ladder-8":item.update(traversalRise=8,surfaceType="ladder")
        if asset_id=="warehouse-16":item.update(walkableHeight=8,surfaceType="roof")
        if asset_id=="tower-8":item.update(walkableHeight=12,surfaceType="roof")
        if asset_id=="container-12":item.update(walkableHeight=4,surfaceType="roof")
        catalog["assets"].append(item)
    (ROOT/"catalog.json").write_text(json.dumps(catalog,indent=2)+"\n")
    summary={"assetCount":len(catalog["assets"]),"totalTriangles":sum(a["statistics"]["triangles"] for a in catalog["assets"]),"totalBytes":sum(a["statistics"]["bytes"] for a in catalog["assets"]),"validation":"24/24 GLB containers, buffer ranges, indices and finite coordinates passed","noExternalDependencies":True}
    (ROOT/"validation.json").write_text(json.dumps(summary,indent=2)+"\n")
    print(json.dumps(summary))


if __name__=="__main__":main()
