#!/usr/bin/env python3
import json, math
from pathlib import Path
import trimesh

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
access_switch_records=[x for x in component_records if x.get("archetype")=="access_switch"]
patch_panel_records=[x for x in component_records if x.get("archetype")=="patch_panel"]
modeled_access_switches=[a for a in assets.values() if a["classification"].get("asset_type")=="access_switch" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_patch_panels=[a for a in assets.values() if a["classification"].get("asset_type")=="patch_panel" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]

if len(access_switch_records)!=len(modeled_access_switches):fail(f"Step 4C access-switch coverage mismatch {len(access_switch_records)}/{len(modeled_access_switches)}")
required_switch_parts={"RACK_CHASSIS","RJ45_PORT_BANK","UPLINK_CAGES","POWER_INPUT","FAN_BANK","STATUS_LEDS","PORT_LABELS"}
for record in access_switch_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_switch_parts.issubset(parts):fail(f"{record.get('asset_id')} missing switch component(s): {sorted(required_switch_parts-parts)}")
    ports={p.get("id") for p in record.get("ports",[])}
    if not {"48x_RJ45_POE","2x_UPLINK"}.issubset(ports):fail(f"{record.get('asset_id')} missing access/uplink port banks")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} access switch archetype not componentized")

if len(patch_panel_records)!=len(modeled_patch_panels):fail(f"Step 4C patch-panel coverage mismatch {len(patch_panel_records)}/{len(modeled_patch_panels)}")
required_patch_parts={"RACK_FRAME","48x_FRONT_JACKS","REAR_TERMINATIONS","LABEL_STRIP","CABLE_MANAGEMENT"}
for record in patch_panel_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_patch_parts.issubset(parts):fail(f"{record.get('asset_id')} missing patch-panel component(s): {sorted(required_patch_parts-parts)}")
    ports={p.get("id") for p in record.get("ports",[])}
    if not {"48x_RJ45_FRONT","48x_REAR_TERMINATION"}.issubset(ports):fail(f"{record.get('asset_id')} missing front/rear termination banks")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} patch panel archetype not componentized")

if rep.get("step4c_componentized_devices_total")!=len(component_records):fail("Step 4C device count mismatch")
if rep.get("step4c_componentized_camera_total")!=len(camera_records):fail("Step 4C camera count mismatch")
if rep.get("step4c_componentized_access_switch_total")!=len(access_switch_records):fail("Step 4C access-switch count mismatch")
if rep.get("step4c_componentized_patch_panel_total")!=len(patch_panel_records):fail("Step 4C patch-panel count mismatch")

rack_ups_records=[x for x in component_records if x.get("archetype")=="rack_ups"]
pdu_records=[x for x in component_records if x.get("archetype")=="pdu"]
fiber_panel_records=[x for x in component_records if x.get("archetype")=="fiber_panel"]
modeled_rack_ups=[a for a in assets.values() if a["classification"].get("asset_type")=="rack_ups" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_pdus=[a for a in assets.values() if a["classification"].get("asset_type")=="pdu" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_fiber_panels=[a for a in assets.values() if a["classification"].get("asset_type")=="fiber_panel" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]

if len(rack_ups_records)!=len(modeled_rack_ups):fail(f"Step 4C rack-UPS coverage mismatch {len(rack_ups_records)}/{len(modeled_rack_ups)}")
required_ups_parts={"RACK_CHASSIS","DISPLAY","BATTERY_MODULE","AC_INPUT","OUTPUT_BANK","STATUS_LEDS"}
for record in rack_ups_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_ups_parts.issubset(parts):fail(f"{record.get('asset_id')} missing rack-UPS component(s): {sorted(required_ups_parts-parts)}")
    if not {"AC_IN","UPS_OUTPUTS"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing UPS input/output ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} rack UPS archetype not componentized")

if len(pdu_records)!=len(modeled_pdus):fail(f"Step 4C PDU coverage mismatch {len(pdu_records)}/{len(modeled_pdus)}")
required_pdu_parts={"RACK_STRIP","POWER_INLET","OUTLET_BANK","BREAKER_OR_PROTECTION","STATUS_INDICATOR"}
for record in pdu_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_pdu_parts.issubset(parts):fail(f"{record.get('asset_id')} missing PDU component(s): {sorted(required_pdu_parts-parts)}")
    if not {"IEC_POWER_IN","IEC_OUTLETS"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing PDU power ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} PDU archetype not componentized")

if len(fiber_panel_records)!=len(modeled_fiber_panels):fail(f"Step 4C fiber-panel coverage mismatch {len(fiber_panel_records)}/{len(modeled_fiber_panels)}")
required_fiber_parts={"RACK_FRAME","LC_ADAPTERS","SPLICE_TRAY","CABLE_ENTRY","LABEL_STRIP"}
for record in fiber_panel_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_fiber_parts.issubset(parts):fail(f"{record.get('asset_id')} missing fiber-panel component(s): {sorted(required_fiber_parts-parts)}")
    if "OS2_LC_DUPLEX_ADAPTERS" not in {p.get("id") for p in record.get("ports",[])}:fail(f"{record.get('asset_id')} missing LC duplex adapter bank")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} fiber panel archetype not componentized")

if rep.get("step4c_componentized_rack_ups_total")!=len(rack_ups_records):fail("Step 4C rack-UPS count mismatch")
if rep.get("step4c_componentized_pdu_total")!=len(pdu_records):fail("Step 4C PDU count mismatch")
if rep.get("step4c_componentized_fiber_panel_total")!=len(fiber_panel_records):fail("Step 4C fiber-panel count mismatch")

data_jack_records=[x for x in component_records if x.get("archetype")=="data_jack"]
receptacle_records=[x for x in component_records if x.get("archetype")=="receptacle"]
wap_spare_jack_records=[x for x in component_records if x.get("archetype")=="wap_spare_jack"]
modeled_data_jacks=[a for a in assets.values() if a["classification"].get("asset_type")=="data_jack" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_receptacles=[a for a in assets.values() if a["classification"].get("asset_type")=="receptacle" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_wap_spare_jacks=[a for a in assets.values() if a["classification"].get("asset_type")=="wap_spare_jack" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]

if len(data_jack_records)!=len(modeled_data_jacks):fail(f"Step 4C data-jack coverage mismatch {len(data_jack_records)}/{len(modeled_data_jacks)}")
required_data_jack_parts={"FACEPLATE","KEYSTONE_JACK","LABEL","REAR_TERMINATION"}
for record in data_jack_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_data_jack_parts.issubset(parts):fail(f"{record.get('asset_id')} missing data-jack component(s): {sorted(required_data_jack_parts-parts)}")
    if not {"RJ45_FRONT","CAT6A_REAR"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing front/rear Cat6A ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} data jack archetype not componentized")

if len(receptacle_records)!=len(modeled_receptacles):fail(f"Step 4C receptacle coverage mismatch {len(receptacle_records)}/{len(modeled_receptacles)}")
required_receptacle_parts={"FACEPLATE","DUPLEX_RECEPTACLE","GROUND_CONTACT","REAR_BRANCH_TERMINATION"}
for record in receptacle_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_receptacle_parts.issubset(parts):fail(f"{record.get('asset_id')} missing receptacle component(s): {sorted(required_receptacle_parts-parts)}")
    if not {"NEMA_5_15_OUTLETS","BRANCH_CIRCUIT_REAR"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing front/rear power ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} receptacle archetype not componentized")

if len(wap_spare_jack_records)!=len(modeled_wap_spare_jacks):fail(f"Step 4C WAP-spare-jack coverage mismatch {len(wap_spare_jack_records)}/{len(modeled_wap_spare_jacks)}")
required_wap_spare_parts={"FACEPLATE_OR_CEILING_JACK","KEYSTONE","LABEL","REAR_TERMINATION"}
for record in wap_spare_jack_records:
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required_wap_spare_parts.issubset(parts):fail(f"{record.get('asset_id')} missing WAP-spare-jack component(s): {sorted(required_wap_spare_parts-parts)}")
    if not {"RJ45_FRONT","CAT6A_REAR"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing reserved front/rear Cat6A ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} WAP spare jack archetype not componentized")

if rep.get("step4c_componentized_data_jack_total")!=len(data_jack_records):fail("Step 4C data-jack count mismatch")
if rep.get("step4c_componentized_receptacle_total")!=len(receptacle_records):fail("Step 4C receptacle count mismatch")
if rep.get("step4c_componentized_wap_spare_jack_total")!=len(wap_spare_jack_records):fail("Step 4C WAP-spare-jack count mismatch")

wireless_ap_records=[x for x in component_records if x.get("archetype")=="wireless_ap"]
workstation_records=[x for x in component_records if x.get("archetype")=="workstation"]
monitor_records=[x for x in component_records if x.get("archetype")=="monitor"]
ip_phone_records=[x for x in component_records if x.get("archetype")=="ip_phone"]
mfp_records=[x for x in component_records if x.get("archetype")=="mfp"]
modeled_wireless_aps=[a for a in assets.values() if a["classification"].get("asset_type")=="wireless_ap" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_workstations=[a for a in assets.values() if a["classification"].get("asset_type")=="workstation" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_monitors=[a for a in assets.values() if a["classification"].get("asset_type")=="monitor" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_ip_phones=[a for a in assets.values() if a["classification"].get("asset_type")=="ip_phone" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_mfps=[a for a in assets.values() if a["classification"].get("asset_type")=="mfp" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]

if len(wireless_ap_records)!=len(modeled_wireless_aps):fail(f"Step 4C wireless-AP coverage mismatch {len(wireless_ap_records)}/{len(modeled_wireless_aps)}")
for record in wireless_ap_records:
    required={"MOUNT","RADOME_HOUSING","STATUS_LED","RJ45_POE_PORT","CABLE_ENTRY"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing wireless-AP component(s): {sorted(required-parts)}")
    ports={p.get("id") for p in record.get("ports",[])}
    if "RJ45_POE_PORT" not in ports:fail(f"{record.get('asset_id')} missing PoE network port")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} wireless AP archetype not componentized")

if len(workstation_records)!=len(modeled_workstations):fail(f"Step 4C workstation coverage mismatch {len(workstation_records)}/{len(modeled_workstations)}")
for record in workstation_records:
    required={"CHASSIS","FRONT_IO","REAR_IO","POWER_SUPPLY","NIC_PORT","DISPLAY_OUTPUTS","STATUS_INDICATOR"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing workstation component(s): {sorted(required-parts)}")
    if not {"AC_IN","RJ45_ETH","DISPLAY_OUT"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing workstation power/network/display ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} workstation archetype not componentized")

if len(monitor_records)!=len(modeled_monitors):fail(f"Step 4C monitor coverage mismatch {len(monitor_records)}/{len(modeled_monitors)}")
for record in monitor_records:
    required={"DISPLAY_PANEL","BEZEL","STAND_OR_MOUNT","POWER_INPUT","VIDEO_INPUT","STATUS_LED"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing monitor component(s): {sorted(required-parts)}")
    if not {"AC_IN","DISPLAYPORT_IN"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing monitor power/video ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} monitor archetype not componentized")

if len(ip_phone_records)!=len(modeled_ip_phones):fail(f"Step 4C IP-phone coverage mismatch {len(ip_phone_records)}/{len(modeled_ip_phones)}")
for record in ip_phone_records:
    required={"BASE","HANDSET","KEYPAD","DISPLAY","STATUS_LED","RJ45_LAN","RJ45_PC"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing IP-phone component(s): {sorted(required-parts)}")
    if not {"RJ45_LAN","RJ45_PC"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing phone LAN/PC ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} IP phone archetype not componentized")

if len(mfp_records)!=len(modeled_mfps):fail(f"Step 4C MFP coverage mismatch {len(mfp_records)}/{len(modeled_mfps)}")
for record in mfp_records:
    required={"CHASSIS","ADF","SCANNER_BED","OUTPUT_TRAY","CONTROL_PANEL","RJ45_PORT","POWER_INLET"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing MFP component(s): {sorted(required-parts)}")
    if not {"AC_IN","RJ45_ETH"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing MFP power/network ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} MFP archetype not componentized")

if rep.get("step4c_componentized_wireless_ap_total")!=len(wireless_ap_records):fail("Step 4C wireless-AP count mismatch")
if rep.get("step4c_componentized_workstation_total")!=len(workstation_records):fail("Step 4C workstation count mismatch")
if rep.get("step4c_componentized_monitor_total")!=len(monitor_records):fail("Step 4C monitor count mismatch")
if rep.get("step4c_componentized_ip_phone_total")!=len(ip_phone_records):fail("Step 4C IP-phone count mismatch")
if rep.get("step4c_componentized_mfp_total")!=len(mfp_records):fail("Step 4C MFP count mismatch")

access_reader_records=[x for x in component_records if x.get("archetype")=="access_reader"]
intercom_records=[x for x in component_records if x.get("archetype")=="intercom"]
access_controller_records=[x for x in component_records if x.get("archetype")=="access_controller"]
modeled_access_readers=[a for a in assets.values() if a["classification"].get("asset_type")=="access_reader" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_intercoms=[a for a in assets.values() if a["classification"].get("asset_type")=="intercom" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_access_controllers=[a for a in assets.values() if a["classification"].get("asset_type")=="access_controller" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]

if len(access_reader_records)!=len(modeled_access_readers):fail(f"Step 4C access-reader coverage mismatch {len(access_reader_records)}/{len(modeled_access_readers)}")
for record in access_reader_records:
    required={"FACEPLATE","READER_ZONE","STATUS_LED","BEEPER","OSDP_TERMINAL","MOUNT"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing access-reader component(s): {sorted(required-parts)}")
    if "OSDP_RS485" not in {p.get("id") for p in record.get("ports",[])}:fail(f"{record.get('asset_id')} missing OSDP reader port")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} access reader archetype not componentized")

if len(intercom_records)!=len(modeled_intercoms):fail(f"Step 4C intercom coverage mismatch {len(intercom_records)}/{len(modeled_intercoms)}")
for record in intercom_records:
    required={"FACEPLATE","CALL_BUTTON","MICROPHONE","SPEAKER","STATUS_LED","RJ45_POE_PORT"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing intercom component(s): {sorted(required-parts)}")
    if "RJ45_POE_PORT" not in {p.get("id") for p in record.get("ports",[])}:fail(f"{record.get('asset_id')} missing intercom PoE port")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} intercom archetype not componentized")

if len(access_controller_records)!=len(modeled_access_controllers):fail(f"Step 4C access-controller coverage mismatch {len(access_controller_records)}/{len(modeled_access_controllers)}")
for record in access_controller_records:
    required={"ENCLOSURE","CONTROLLER_BOARD","ETHERNET_PORT","OSDP_TERMINALS","POWER_INPUT","BATTERY_ZONE","STATUS_LEDS"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing access-controller component(s): {sorted(required-parts)}")
    if not {"AC_IN","RJ45_ETH","OSDP_BUSES"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing access-controller power/network/OSDP ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} access controller archetype not componentized")

if rep.get("step4c_componentized_access_reader_total")!=len(access_reader_records):fail("Step 4C access-reader count mismatch")
if rep.get("step4c_componentized_intercom_total")!=len(intercom_records):fail("Step 4C intercom count mismatch")
if rep.get("step4c_componentized_access_controller_total")!=len(access_controller_records):fail("Step 4C access-controller count mismatch")

electrical_panel_records=[x for x in component_records if x.get("archetype")=="electrical_panel"]
bas_controller_records=[x for x in component_records if x.get("archetype")=="bas_controller"]
environment_sensor_records=[x for x in component_records if x.get("archetype")=="environment_sensor"]
modeled_electrical_panels=[a for a in assets.values() if a["classification"].get("asset_type")=="electrical_panel" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_bas_controllers=[a for a in assets.values() if a["classification"].get("asset_type")=="bas_controller" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_environment_sensors=[a for a in assets.values() if a["classification"].get("asset_type")=="environment_sensor" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]

if len(electrical_panel_records)!=len(modeled_electrical_panels):fail(f"Step 4C electrical-panel coverage mismatch {len(electrical_panel_records)}/{len(modeled_electrical_panels)}")
for record in electrical_panel_records:
    required={"ENCLOSURE","DEADFRONT","MAIN_BREAKER","BRANCH_BREAKERS","CIRCUIT_DIRECTORY","NEUTRAL_GROUND_BARS"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing electrical-panel component(s): {sorted(required-parts)}")
    if not {"FEEDER_INPUT","BRANCH_CIRCUIT_OUTPUTS"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing panel feeder/branch ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} electrical panel archetype not componentized")

if len(bas_controller_records)!=len(modeled_bas_controllers):fail(f"Step 4C BAS-controller coverage mismatch {len(bas_controller_records)}/{len(modeled_bas_controllers)}")
for record in bas_controller_records:
    required={"ENCLOSURE","CONTROLLER_BOARD","ETHERNET_PORT","BACNET_TERMINALS","POWER_INPUT","STATUS_LEDS"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing BAS-controller component(s): {sorted(required-parts)}")
    if not {"AC_IN","RJ45_ETH","BACNET_MSTP"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing BAS power/network/field-bus ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} BAS controller archetype not componentized")

if len(environment_sensor_records)!=len(modeled_environment_sensors):fail(f"Step 4C environment-sensor coverage mismatch {len(environment_sensor_records)}/{len(modeled_environment_sensors)}")
for record in environment_sensor_records:
    required={"HOUSING","SENSOR_VENTS","STATUS_INDICATOR","BACNET_TERMINAL","24V_TERMINAL"}
    parts={x.get("component_id") for x in record.get("components",[])}
    if not required.issubset(parts):fail(f"{record.get('asset_id')} missing environment-sensor component(s): {sorted(required-parts)}")
    if not {"BACNET_MSTP","24VDC_CLASS2"}.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing sensor BACnet/Class-2 ports")
    if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} environment sensor archetype not componentized")

if rep.get("step4c_componentized_electrical_panel_total")!=len(electrical_panel_records):fail("Step 4C electrical-panel count mismatch")
if rep.get("step4c_componentized_bas_controller_total")!=len(bas_controller_records):fail("Step 4C BAS-controller count mismatch")
if rep.get("step4c_componentized_environment_sensor_total")!=len(environment_sensor_records):fail("Step 4C environment-sensor count mismatch")

av_microphone_records=[x for x in component_records if x.get("archetype")=="av_microphone"]
speaker_records=[x for x in component_records if x.get("archetype")=="speaker"]
fire_detector_records=[x for x in component_records if x.get("archetype")=="fire_detector"]
fire_notification_records=[x for x in component_records if x.get("archetype")=="fire_notification"]
facp_records=[x for x in component_records if x.get("archetype")=="fire_alarm_control_panel"]
fire_gateway_records=[x for x in component_records if x.get("archetype")=="fire_alarm_read_only_gateway"]
modeled_av_microphones=[a for a in assets.values() if a["classification"].get("asset_type")=="av_microphone" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_speakers=[a for a in assets.values() if a["classification"].get("asset_type")=="speaker" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_fire_detectors=[a for a in assets.values() if a["classification"].get("asset_type")=="fire_detector" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_fire_notifications=[a for a in assets.values() if a["classification"].get("asset_type")=="fire_notification" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_facps=[a for a in assets.values() if a["classification"].get("asset_type")=="fire_alarm_control_panel" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]
modeled_fire_gateways=[a for a in assets.values() if a["classification"].get("asset_type")=="fire_alarm_read_only_gateway" and a["source_snapshot"].get("source")=="electronics_step4a_policy"]

for records,modeled,label,required,ports in [
    (av_microphone_records,modeled_av_microphones,"AV microphone",{"BODY","CAPSULE_OR_ARRAY","STATUS_LED","RJ45_POE_PORT","MOUNT"},{"RJ45_POE_PORT"}),
    (speaker_records,modeled_speakers,"speaker",{"GRILLE_OR_CABINET","DRIVER","MOUNT","SPEAKER_TERMINALS"},{"SPEAKER_PAIR"}),
    (fire_detector_records,modeled_fire_detectors,"fire detector",{"BASE","SENSING_CHAMBER","STATUS_LED","SLC_TERMINALS"},{"FIRE_ALARM_SLC"}),
    (fire_notification_records,modeled_fire_notifications,"fire notification",{"HOUSING","STROBE","SOUNDER","NAC_TERMINALS"},{"FIRE_ALARM_NAC"}),
    (facp_records,modeled_facps,"FACP",{"ENCLOSURE","DISPLAY","KEYPAD","STATUS_LEDS","SLC_TERMINALS","NAC_TERMINALS","POWER_SECTION"},{"AC_IN","SLC","NAC","READ_ONLY_GATEWAY_LINK"}),
    (fire_gateway_records,modeled_fire_gateways,"fire gateway",{"ENCLOSURE","FIRE_INTERFACE","RJ45_PORT","POWER_INPUT","STATUS_LEDS"},{"FIRE_INTERFACE","RJ45_ETH","AC_IN"}),
]:
    if len(records)!=len(modeled):fail(f"Step 4C {label} coverage mismatch {len(records)}/{len(modeled)}")
    for record in records:
        parts={x.get("component_id") for x in record.get("components",[])}
        if not required.issubset(parts):fail(f"{record.get('asset_id')} missing {label} component(s): {sorted(required-parts)}")
        if not ports.issubset({p.get("id") for p in record.get("ports",[])}):fail(f"{record.get('asset_id')} missing {label} required ports")
        if record.get("maturity")!="componentized":fail(f"{record.get('asset_id')} {label} archetype not componentized")

if rep.get("step4c_componentized_av_microphone_total")!=len(av_microphone_records):fail("Step 4C AV-microphone count mismatch")
if rep.get("step4c_componentized_speaker_total")!=len(speaker_records):fail("Step 4C speaker count mismatch")
if rep.get("step4c_componentized_fire_detector_total")!=len(fire_detector_records):fail("Step 4C fire-detector count mismatch")
if rep.get("step4c_componentized_fire_notification_total")!=len(fire_notification_records):fail("Step 4C fire-notification count mismatch")
if rep.get("step4c_componentized_fire_alarm_control_panel_total")!=len(facp_records):fail("Step 4C FACP count mismatch")
if rep.get("step4c_componentized_fire_alarm_read_only_gateway_total")!=len(fire_gateway_records):fail("Step 4C fire-gateway count mismatch")







# Prove the component catalog is not metadata-only: every componentized
# reference family must have its named assembly parts in the generated GLB.
scene=trimesh.load(GLB,force="scene",process=False)
node_names=set(scene.graph.nodes_geometry)
for record in camera_records+access_switch_records+patch_panel_records+rack_ups_records+pdu_records+fiber_panel_records+data_jack_records+receptacle_records+wap_spare_jack_records+wireless_ap_records+workstation_records+monitor_records+ip_phone_records+mfp_records+access_reader_records+intercom_records+access_controller_records+electrical_panel_records+bas_controller_records+environment_sensor_records+av_microphone_records+speaker_records+fire_detector_records+fire_notification_records+facp_records+fire_gateway_records:
    for part in record.get("components",[]):
        mesh_name=part.get("mesh_name")
        if mesh_name not in node_names:
            fail(f"{record.get('asset_id')} component mesh missing from GLB: {mesh_name}")

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
