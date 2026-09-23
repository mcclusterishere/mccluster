#!/usr/bin/env python3
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
REG=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-v1.json"
MAN=HERE/"generated/equity-uprise-electronics-manifest-v1.json"
CONN=HERE/"generated/equity-uprise-electronics-connections-v1.json"
LABS=HERE/"generated/equity-uprise-it-lab-catalog-v1.json"
REP=HERE/"generated/equity-uprise-electronics-step4a-report.json"
GLB=HERE/"generated/equity-uprise-electronics-fabric-v1.glb"
POL=HERE/"electronics-population-policy-v1.json"
def load(p):return json.loads(Path(p).read_text())
def fail(m):raise SystemExit("ELECTRONICS STEP 4A: FAIL\n"+m)
r=load(REG); m=load(MAN); c=load(CONN); l=load(LABS); rep=load(REP); p=load(POL)
if r.get("registry_version")!="step4a-whole-building-electronics-fabric-v1":fail("registry is not Step 4A")
if rep.get("status")!="step4a-whole-building-electronics-fabric" or rep.get("passed") is not True:fail("report not passing")
if not GLB.exists() or GLB.stat().st_size!=rep.get("overlay_glb_bytes"):fail("overlay GLB missing/stale")
assets={a["asset_id"]:a for a in r["assets"]}
conns=c.get("connections",[])
if len(conns)!=rep.get("physical_connections_total"):fail("connection count mismatch")
if any(x["from_asset_id"] not in assets or x["to_asset_id"] not in assets for x in conns):fail("connection endpoint missing")
if not set(x["cable_type"] for x in conns).issubset(p["cable_types"]):fail("unknown cable type")
if any(a["security"].get("live_control_allowed") for a in assets.values()):fail("LIVE control enabled")
waps=[a for a in assets.values() if a["classification"].get("asset_type")=="wireless_ap"]
spares=[a for a in assets.values() if a["classification"].get("asset_type")=="wap_spare_jack"]
if len(waps)!=len(spares):fail("WAP/spare drop mismatch")
for a in waps:
    links=[x for x in conns if x["to_asset_id"]==a["asset_id"] and x["cable_type"]=="CAT6A-HORIZONTAL"]
    if len(links)!=1 or links[0].get("power_transport")!="PoE":fail(f"{a['asset_id']} missing active PoE Cat6A link")
switches=[a for a in assets.values() if a["classification"].get("asset_type")=="access_switch"]
cores=[a["asset_id"] for a in assets.values() if a["classification"].get("asset_type")=="collapsed_core_switch"]
for a in switches:
    if len([x for x in conns if x["from_asset_id"]==a["asset_id"] and x["to_asset_id"] in cores])<2:fail(f"{a['asset_id']} missing dual uplinks")
fire_types={"fire_detector","fire_notification"}
if any(x["cable_type"].startswith("CAT6A") and assets[x["to_asset_id"]]["classification"].get("asset_type") in fire_types for x in conns):fail("fire alarm field device directly on general LAN")
for a in assets.values():
    if a["classification"].get("asset_type")=="environment_sensor":
        if not any(x["to_asset_id"]==a["asset_id"] and x["cable_type"]=="BACNET-MSTP-STP" for x in conns):fail(f"{a['asset_id']} missing BAS field bus")
    if a["classification"].get("asset_type")=="access_reader":
        if not any(x["to_asset_id"]==a["asset_id"] and x["cable_type"]=="OSDP-RS485-STP" for x in conns):fail(f"{a['asset_id']} missing OSDP")
labs=l.get("labs",[])
if len(labs)<40 or set(x["tier"] for x in labs)!=set(p["lab_tiers"]):fail("lab ladder incomplete")
if rep.get("checks_failed")!=0:fail("report has failed checks")
print("EQUITY UPRISE ELECTRONICS STEP 4A: PASS")
print(" registry assets:",rep["registry_assets_total"])
print(" new electronics assets:",rep["step4a_new_assets"])
print(" physical connections:",rep["physical_connections_total"])
print(" wireless links:",rep["wireless_links_total"])
print(" labs:",rep["lab_scenarios_total"])
print(" overlay bytes:",rep["overlay_glb_bytes"])
