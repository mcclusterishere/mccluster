#!/usr/bin/env python3
import json, math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
REG=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-v1.json"
MAN=HERE/"generated/equity-uprise-electronics-manifest-v1.json"
CONN=HERE/"generated/equity-uprise-electronics-connections-v1.json"
LABS=HERE/"generated/equity-uprise-it-lab-catalog-v1.json"
REP=HERE/"generated/equity-uprise-electronics-step4a-report.json"  # compatibility path; report status is Step 4B
GLB=HERE/"generated/equity-uprise-electronics-fabric-v1.glb"
DEV=HERE/"generated/equity-uprise-device-components-v1.json"
ARCH=HERE/"device-archetypes-v1.json"
POL=HERE/"electronics-population-policy-v1.json"

def load(p):return json.loads(Path(p).read_text())
def fail(m):raise SystemExit("ELECTRONICS STEP 4B PHYSICAL INSTALLATION: FAIL\n"+m)

r=load(REG); m=load(MAN); c=load(CONN); l=load(LABS); rep=load(REP); p=load(POL); dev=load(DEV); arch=load(ARCH)
if r.get("registry_version")!="step4b-physical-installation-fabric-v1":fail("registry is not Step 4B")
if rep.get("status")!="step4b-physical-installation-fabric" or rep.get("passed") is not True:fail("Step 4B report not passing")
if m.get("status")!="step4b-physical-installation-fabric":fail("manifest is not Step 4B")
if c.get("status")!="step4b-physical-installation-connections":fail("connection graph is not Step 4B")
if not GLB.exists() or GLB.stat().st_size!=rep.get("overlay_glb_bytes"):fail("overlay GLB missing/stale")
if dev.get("status")!="step4c-device-components":fail("device component catalog is not Step 4C")
if arch.get("status")!="step4c-device-archetype-authority":fail("device archetype authority is not Step 4C")
if m.get("device_component_catalog")!="docs/design/equity-uprise-building/production/electronics/generated/equity-uprise-device-components-v1.json":fail("manifest missing Step 4C device catalog authority")
if m.get("device_archetype_authority")!="docs/design/equity-uprise-building/production/electronics/device-archetypes-v1.json":fail("manifest missing Step 4C archetype authority")

assets={a["asset_id"]:a for a in r["assets"]}
conns=c.get("connections",[])
if len(conns)!=rep.get("physical_connections_total"):fail("connection count mismatch")
if any(x["from_asset_id"] not in assets or x["to_asset_id"] not in assets for x in conns):fail("connection endpoint missing")
if not set(x["cable_type"] for x in conns).issubset(p["cable_types"]):fail("unknown cable type")
if any(a["security"].get("live_control_allowed") for a in assets.values()):fail("LIVE control enabled")

# Physical plant must be traceable rather than an abstract graph.
for x in conns:
    route=x.get("route") or []
    if len(route)<2:fail(f"{x['connection_id']} has no physical route")
    if not x.get("from_port") or not x.get("to_port"):fail(f"{x['connection_id']} has incomplete port IDs")
    md=x.get("metadata") or {}
    if not md.get("pathway_class"):fail(f"{x['connection_id']} missing pathway class")
    if md.get("route_length_ft") is None:fail(f"{x['connection_id']} missing route length")
    for point in route:
        if not isinstance(point,list) or len(point)!=3:fail(f"{x['connection_id']} route point malformed")
        if not all(math.isfinite(float(v)) for v in point):fail(f"{x['connection_id']} route point non-finite")

# Horizontal permanent links remain within the 90 m design-intent limit.
for x in conns:
    if x["cable_type"] in {"CAT6A-HORIZONTAL","CAT6A-WAP-SPARE"}:
        if float(x.get("metadata",{}).get("route_length_ft",1e9))>295.276:
            fail(f"{x['connection_id']} exceeds 90 m permanent-link limit")

waps=[a for a in assets.values() if a["classification"].get("asset_type")=="wireless_ap"]
spares=[a for a in assets.values() if a["classification"].get("asset_type")=="wap_spare_jack"]
if len(waps)!=len(spares):fail("WAP/spare drop mismatch")
for a in waps:
    aid=a["asset_id"]; jack=aid+"::DATA-JACK"
    if jack not in assets:fail(f"{aid} missing physical data jack")
    permanents=[x for x in conns if x["to_asset_id"]==jack and x["cable_type"]=="CAT6A-HORIZONTAL"]
    patches=[x for x in conns if x["from_asset_id"]==jack and x["to_asset_id"]==aid and x["cable_type"]=="CAT6A-PATCH"]
    if len(permanents)!=1 or len(patches)!=1 or patches[0].get("power_transport")!="PoE":
        fail(f"{aid} missing permanent-link/jack/PoE-patch chain")

switches=[a for a in assets.values() if a["classification"].get("asset_type")=="access_switch"]
cores=[a["asset_id"] for a in assets.values() if a["classification"].get("asset_type")=="collapsed_core_switch"]
for a in switches:
    uplinks=[x for x in conns if x["from_asset_id"]==a["asset_id"] and x["to_asset_id"] in cores]
    if len(uplinks)<2:fail(f"{a['asset_id']} missing dual uplinks")

# 120V branches now terminate at floor outlets; equipment plugs into those outlets.
for x in conns:
    if x["cable_type"]=="120VAC-BRANCH" and assets[x["to_asset_id"]]["classification"].get("asset_type") not in {"receptacle","electrical_panel"}:
        fail(f"{x['connection_id']} bypasses outlet/panel termination")
outlets=[a for a in assets.values() if a["classification"].get("asset_type")=="receptacle" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
for a in outlets:
    if not any(x["from_asset_id"]==a["asset_id"] and x["cable_type"]=="NEMA5-15-POWER-CORD" for x in conns):
        fail(f"{a['asset_id']} does not serve a plug-connected load")

panels=[a for a in assets.values() if a["classification"].get("asset_type")=="electrical_panel" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
if len(panels)<14:fail("expected normal/emergency panelboards for B1-F6")
for a in panels:
    if not any(x["to_asset_id"]==a["asset_id"] and x["cable_type"]=="208Y120V-FEEDER" for x in conns):
        fail(f"{a['asset_id']} missing riser feeder")

fire_types={"fire_detector","fire_notification"}
if any(x["cable_type"].startswith("CAT6A") and assets[x["to_asset_id"]]["classification"].get("asset_type") in fire_types for x in conns):
    fail("fire alarm field device directly on general LAN")

for a in assets.values():
    t=a["classification"].get("asset_type")
    if t=="environment_sensor":
        if not any(x["to_asset_id"]==a["asset_id"] and x["cable_type"]=="BACNET-MSTP-STP" for x in conns):
            fail(f"{a['asset_id']} missing BAS field bus")
        if not any(x["to_asset_id"]==a["asset_id"] and x["cable_type"]=="24VDC-CLASS2" for x in conns):
            fail(f"{a['asset_id']} missing modeled Class 2 power")
    if t=="access_reader":
        if not any(x["to_asset_id"]==a["asset_id"] and x["cable_type"]=="OSDP-RS485-STP" for x in conns):
            fail(f"{a['asset_id']} missing OSDP")

component_records=dev.get("devices",[])
camera_records=[x for x in component_records if x.get("archetype")=="camera"]
modeled_cameras=[a for a in assets.values() if a["classification"].get("asset_type")=="camera" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
if len(camera_records)!=len(modeled_cameras):fail(f"Step 4C camera coverage mismatch {len(camera_records)}/{len(modeled_cameras)}")
required_camera_parts={"MOUNT_PLATE","BRACKET_ARM","HOUSING","LENS_BARREL","LENS_GLASS","IR_LED_RING","STATUS_LED","RJ45_POE_PORT","CABLE_ENTRY"}
for record in camera_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_camera_parts.issubset(parts):fail(f"{record.get('asset_id')} missing camera component(s): {sorted(required_camera_parts-parts)}")
    ports=record.get("ports",[])
    if not any(p.get("id")=="RJ45_POE_PORT" and {"Ethernet/IP","PoE"}.issubset(set(p.get("services",[]))) for p in ports):
        fail(f"{record.get('asset_id')} missing functional RJ45/PoE port")
    if record.get("maturity")!="lab_complete":fail(f"{record.get('asset_id')} camera archetype not lab_complete")
    if not {"normal","unavailable","degraded","faulted"}.issubset(set(record.get("state_rules",{}))):
        fail(f"{record.get('asset_id')} missing visible state rules")
if rep.get("step4c_componentized_devices_total")!=len(component_records):fail("Step 4C device count mismatch")
if rep.get("step4c_componentized_camera_total")!=len(camera_records):fail("Step 4C camera count mismatch")

labs=l.get("labs",[])
if len(labs)<40 or set(x["tier"] for x in labs)!=set(p["lab_tiers"]):fail("lab ladder incomplete")
if rep.get("checks_failed")!=0:fail("report has failed checks")
if rep.get("routed_connections_total")!=len(conns):fail("report routed-connection count mismatch")
if rep.get("port_complete_connections_total")!=len(conns):fail("report port-complete count mismatch")

print("EQUITY UPRISE ELECTRONICS STEP 4B PHYSICAL INSTALLATION: PASS")
print(" registry assets:",rep["registry_assets_total"])
print(" new/derived electronics assets:",rep["step4b_new_assets"])
print(" physical connections:",rep["physical_connections_total"])
print(" routed connections:",rep["routed_connections_total"])
print(" port-complete connections:",rep["port_complete_connections_total"])
print(" data jacks:",rep["data_jacks_total"])
print(" receptacles:",rep["receptacles_total"])
print(" electrical panelboards:",rep["electrical_panelboards_total"])
print(" Step 4C componentized cameras:",rep["step4c_componentized_camera_total"])
print(" wireless links:",rep["wireless_links_total"])
print(" labs:",rep["lab_scenarios_total"])
print(" overlay bytes:",rep["overlay_glb_bytes"])
