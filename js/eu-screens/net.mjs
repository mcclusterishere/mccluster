/* Equity Uprise screens — the network as the screens see it, derived from the sandbox graph.

   Everything here is a READ of the canonical connection graph and the live sandbox state:
     switch port tables (switch Gi port -> patch panel -> permanent link -> jack -> patch cord -> endpoint),
     uplinks (UPLINK-1/2 -> core), VLAN membership by device role, a SANDBOX addressing plan, hostnames,
     reachability for ping/traceroute and the per-device status the NOC, VMS and terminal show.

   The addressing plan (10.<vlan>.<level>.<host>) and hostnames are a deterministic teaching plan derived from the
   VLAN catalogue in the electronics manifest; they are not an as-built IP schedule. */

export const LEVEL_INDEX = Object.freeze({ B1: 0, F1: 1, F2: 2, F3: 3, F4: 4, F5: 5, F6: 6, L7: 7 });
export const DOMAIN = "eu.sandbox";

const VLAN_BY_TYPE = Object.freeze({
  access_switch: 10, collapsed_core_switch: 10, firewall: 10, edge_router: 10, rack_ups: 10, wireless_ap: 10, fiber_panel: 10,
  virtualization_host: 110, nas_storage: 110, backup_appliance: 110, vms_nvr: 70, camera: 70,
  workstation: 20, ip_phone: 50, network_display_decoder: 60, av_controller: 60, av_dsp: 60, av_camera: 60, av_microphone: 60,
  bas_controller: 90, access_controller: 80, access_reader: 80, intercom: 80, mfp: 120, carrier_cpe: 130,
});
const WRONG_VLAN = 40; /* what a mis-set access port lands on in the sandbox: the guest VLAN */
const SERVICE_IP = Object.freeze({
  "LOGIC-SVC-DNS": "10.110.0.53", "LOGIC-SVC-DHCP": "10.110.0.67", "LOGIC-SVC-NTP": "10.110.0.123",
  "LOGIC-SVC-AAA-RADIUS": "10.110.0.18", "LOGIC-SVC-DIRECTORY-IDP": "10.110.0.19", "LOGIC-SVC-SYSLOG-SIEM": "10.110.0.14",
  "LOGIC-SVC-SNMP-NMS": "10.110.0.16", "LOGIC-SVC-CONFIG-BACKUP": "10.110.0.21", "LOGIC-SVC-WLAN-CONTROLLER": "10.110.0.25",
  "LOGIC-SVC-BAS-SUPERVISOR": "10.90.0.10", "LOGIC-SVC-AV-CONTROL": "10.60.0.10", "LOGIC-SVC-FILE-SHARE": "10.110.0.45",
  "LOGIC-SVC-BACKUP-SERVICE": "10.110.0.46", "LOGIC-SVC-VMS": "10.70.0.5", "LOGIC-SVC-VPN-REMOTE-ACCESS": "10.130.0.10",
});
/* systemd-style unit names for the logical services (the names a Linux admin would type) */
export const SERVICE_UNITS = Object.freeze({
  dhcpd: "LOGIC-SVC-DHCP", named: "LOGIC-SVC-DNS", chronyd: "LOGIC-SVC-NTP", radiusd: "LOGIC-SVC-AAA-RADIUS",
  "directory-idp": "LOGIC-SVC-DIRECTORY-IDP", rsyslog: "LOGIC-SVC-SYSLOG-SIEM", snmpd: "LOGIC-SVC-SNMP-NMS",
  "config-backup": "LOGIC-SVC-CONFIG-BACKUP", "wlan-controller": "LOGIC-SVC-WLAN-CONTROLLER", "bas-supervisor": "LOGIC-SVC-BAS-SUPERVISOR",
  "av-control": "LOGIC-SVC-AV-CONTROL", smbd: "LOGIC-SVC-FILE-SHARE", "backup-agent": "LOGIC-SVC-BACKUP-SERVICE", vms: "LOGIC-SVC-VMS",
  openvpn: "LOGIC-SVC-VPN-REMOTE-ACCESS",
});
const SERVICE_FAULT_UNIT = Object.freeze({ dhcp_service_down: "dhcpd", dns_service_down: "named", ntp_service_down: "chronyd" });
export { SERVICE_FAULT_UNIT };

export function hostnameFor(assetId) {
  let m;
  if ((m = /^(B1|F[1-6]|L7)-NET-ACCESS-SW-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-idf-sw${m[2]}`;
  if ((m = /^B1-NET-CORE-SW-01-I00(\d)$/.exec(assetId))) return `b1-core-sw0${m[1]}`;
  if ((m = /^B1-NET-FW-01-I00(\d)$/.exec(assetId))) return `b1-fw0${m[1]}`;
  if (assetId === "B1-NET-EDGE-RTR-01") return "b1-edge-rtr01";
  if ((m = /^B1-SRV-HYP-01-I00(\d)$/.exec(assetId))) return `b1-hyp0${m[1]}`;
  if (assetId === "B1-SRV-NAS-01") return "b1-nas01";
  if (assetId === "B1-SRV-BACKUP-01") return "b1-bkp01";
  if (assetId === "B1-SEC-NVR-01") return "b1-nvr01";
  if ((m = /^(B1|F[1-6]|L7)-ICT-RACK-UPS-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-ups${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-USER-WS-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-ws${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-SEC-CAM-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-cam${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-NET-WAP-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-wap${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-VOICE-PHONE-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-phone${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-BAS-CTRL-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-bas${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-AV-CTRL-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-av-ctrl${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-AV-MIC-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-mic${m[2]}`;
  if ((m = /^(B1|F[1-6]|L7)-AV-CAM-(\d+)$/.exec(assetId))) return `${m[1].toLowerCase()}-av-cam${m[2]}`;
  if ((m = /^(.+)::AV-DECODER$/.exec(assetId))) return m[1].toLowerCase().replace(/-0?(\d+)$/, "$1").replace(/[^a-z0-9-]/g, "") + "-dec";
  return assetId.toLowerCase().replace(/::/g, "-").replace(/[^a-z0-9-]/g, "");
}

export function createNet(ss) {
  const sb = ss.sandbox;
  const assets = sb.assetsById;
  const conns = sb.connectionsById;
  const typeOf = (id) => { const a = assets.get(id); return a && a.classification ? a.classification.asset_type : null; };
  const levelOf = (id) => { const a = assets.get(id); return a && a.location ? a.location.level_id : null; };
  const out = (id) => (sb.outgoingConnectionIds.get(id) || []).map((c) => conns.get(c)).filter(Boolean);
  const inc = (id) => (sb.incomingConnectionIds.get(id) || []).map((c) => conns.get(c)).filter(Boolean);

  /* ---- topology (static: built once from the graph) */
  const NETWORKED = new Set(Object.keys(VLAN_BY_TYPE));
  const hosts = new Map();      /* hostname -> asset id */
  const hostOf = new Map();     /* asset id -> hostname */
  for (const [id, a] of assets) {
    const t = a.classification && a.classification.asset_type;
    if (!NETWORKED.has(t) || (id.includes("::") && !id.endsWith("::AV-DECODER"))) continue;
    const h = hostnameFor(id);
    hosts.set(h, id); hostOf.set(id, h);
  }
  const svcHost = {};
  for (const [unit, id] of Object.entries(SERVICE_UNITS)) { const h = unit === "named" ? "ns1" : unit === "dhcpd" ? "dhcp1" : unit === "chronyd" ? "ntp1" : unit; svcHost[id] = h; hosts.set(h, id); hostOf.set(id, h); }

  /* ports: switch -> [{ port, endpoint, panelPort, links:[connection ids], kind }] */
  const portTables = new Map();
  const endpointPort = new Map(); /* endpoint asset id -> { switchId, port } */
  for (const [id] of assets) {
    if (!["access_switch", "collapsed_core_switch"].includes(typeOf(id))) continue;
    const rows = [];
    for (const c of out(id)) {
      if (c.cable_type === "CAT6A-PATCH" && typeOf(c.to_asset_id) === "patch_panel") {
        const panel = c.to_asset_id;
        const horiz = out(panel).find((h) => h.cable_type === "CAT6A-HORIZONTAL" && h.from_port === c.to_port);
        const jack = horiz ? horiz.to_asset_id : null;
        const cord = jack ? out(jack).find((p) => p.cable_type === "CAT6A-PATCH") : null;
        const endpoint = cord ? cord.to_asset_id : null;
        rows.push({ port: c.from_port, endpoint, panelPort: c.to_port, links: [c.connection_id, horiz && horiz.connection_id, cord && cord.connection_id].filter(Boolean), kind: endpoint ? "access" : "unused" });
        if (endpoint) endpointPort.set(endpoint, { switchId: id, port: c.from_port });
      } else if (["OS2-SM-DUPLEX", "10G-DAC"].includes(c.cable_type)) {
        const n = /UPLINK-(\d+)/.exec(c.from_port || "");
        rows.push({ port: n ? "Te1/1/" + n[1] : c.from_port, endpoint: c.to_asset_id, peerPort: c.to_port, links: [c.connection_id], kind: "uplink", cable: c.cable_type });
      }
    }
    for (const c of inc(id)) {
      if (["OS2-SM-DUPLEX", "10G-DAC"].includes(c.cable_type)) rows.push({ port: c.to_port, endpoint: c.from_asset_id, peerPort: c.from_port, links: [c.connection_id], kind: "downlink", cable: c.cable_type });
    }
    const order = (p) => { const m = /(\d+)\/(\d+)\/(\d+)$/.exec(p.port || ""); return m ? (p.port.startsWith("Te") ? 1000 : 0) + Number(m[3]) : 2000; };
    rows.sort((a, b) => order(a) - order(b) || String(a.port).localeCompare(String(b.port)));
    portTables.set(id, rows);
  }

  /* addressing plan: 10.<vlan>.<level>.<n>, n from 11 upward in asset-id order per (vlan, level) */
  const ipOf = new Map(), byIp = new Map();
  const groups = new Map();
  for (const id of [...hostOf.keys()].sort()) {
    if (SERVICE_IP[id]) { ipOf.set(id, SERVICE_IP[id]); byIp.set(SERVICE_IP[id], id); continue; }
    const vlan = expectedVlan(id); const lv = LEVEL_INDEX[levelOf(id)] ?? 0;
    const key = vlan + ":" + lv;
    const n = (groups.get(key) || 10) + 1; groups.set(key, n);
    const ip = `10.${vlan}.${lv}.${typeOf(id) === "access_switch" ? n - 9 : n}`;
    ipOf.set(id, ip); byIp.set(ip, id);
  }

  function expectedVlan(id) {
    const t = typeOf(id);
    if (t === "workstation" && levelOf(id) === "B1") return 30;
    return VLAN_BY_TYPE[t] || 10;
  }

  /* ---- live state */
  const st = (id) => ss.state(id);
  const has = (id, f) => ss.has(id, f);
  const up = (id) => { const s = st(id); return !s || s.availability !== "unavailable"; };

  function portStatus(switchId, row) {
    if (!up(switchId)) return { status: "down", vlan: null, voice: null, poe: null, reason: "switch unreachable" };
    if (row.kind === "unused") return { status: "notconnect", vlan: 1, voice: null, poe: "n/a", reason: null };
    if (row.kind !== "access") {
      const cs = ss.connState(row.links[0]);
      const flags = cs ? cs.condition_flags : [];
      if (row.kind === "uplink" && flags.includes("uplink_down")) return { status: "disabled", vlan: "trunk", reason: "uplink_down" };
      if (cs && cs.availability === "unavailable") return { status: "notconnect", vlan: "trunk", reason: flags[0] || "link down" };
      return { status: "connected", vlan: "trunk", reason: null };
    }
    const e = row.endpoint;
    const exp = expectedVlan(e);
    const t = typeOf(e);
    const poeCapable = ["camera", "wireless_ap", "ip_phone", "access_reader", "intercom", "av_camera", "av_microphone"].includes(t);
    let vlan = t === "ip_phone" ? 20 : exp, voice = t === "ip_phone" ? 50 : null, poe = poeCapable ? "on" : "n/a", status = "connected", reason = null;
    if (has(e, "wrong_vlan")) { vlan = WRONG_VLAN; reason = "wrong_vlan"; }
    if (has(e, "voice_vlan_wrong")) { voice = 20; reason = "voice_vlan_wrong"; }
    if (has(e, "port_shutdown")) { status = "disabled"; reason = "port_shutdown"; }
    else if (has(e, "poe_disabled")) { status = "notconnect"; poe = "off"; reason = "poe_disabled"; }
    else if (has(e, "camera_link_down") || has(e, "ap_link_down")) { status = "notconnect"; reason = "link down"; }
    else if (!up(e)) { status = "notconnect"; reason = (st(e) && st(e).condition_flags[0]) || "endpoint down"; }
    return { status, vlan, voice, poe, reason };
  }

  function accessSwitchOf(id) {
    if (endpointPort.has(id)) return endpointPort.get(id).switchId;
    const t = typeOf(id);
    if (t === "access_switch" || t === "collapsed_core_switch") return id;
    if (["virtualization_host", "nas_storage", "backup_appliance", "vms_nvr", "firewall", "edge_router"].includes(t) || SERVICE_IP[id]) return "B1-NET-CORE-SW-01-I001";
    const lv = levelOf(id);
    const sw = `${lv === "L7" ? "F6" : lv}-NET-ACCESS-SW-01`;
    return assets.has(sw) ? sw : null;
  }

  function coreUp() { return up("B1-NET-CORE-SW-01-I001") || up("B1-NET-CORE-SW-01-I002"); }

  function uplinkUp(switchId) {
    if (typeOf(switchId) !== "access_switch") return true;
    const ups = (portTables.get(switchId) || []).filter((r) => r.kind === "uplink");
    return ups.some((r) => portStatus(switchId, r).status === "connected");
  }

  /* where a host sits on the network right now: { ok, ip, vlan, reason } */
  function hostNet(id) {
    if (SERVICE_IP[id]) {
      return { ok: up(id), ip: ipOf.get(id), vlan: Number(SERVICE_IP[id].split(".")[1]), reason: up(id) ? null : "service down" };
    }
    if (!up(id) && !has(id, "wrong_vlan")) return { ok: false, ip: ipOf.get(id) || null, vlan: expectedVlan(id), reason: (st(id) && st(id).condition_flags[0]) || "down" };
    const p = endpointPort.get(id);
    if (p) {
      const ps = portStatus(p.switchId, (portTables.get(p.switchId) || []).find((r) => r.port === p.port));
      if (ps.status !== "connected") return { ok: false, ip: null, vlan: ps.vlan, reason: ps.reason || ps.status };
      if (ps.vlan === WRONG_VLAN) {
        const lv = LEVEL_INDEX[levelOf(id)] ?? 0;
        return { ok: true, ip: `10.${WRONG_VLAN}.${lv}.${100 + (Number(String(ipOf.get(id) || "0").split(".").pop()) % 100)}`, vlan: WRONG_VLAN, reason: "guest VLAN (internet only)", guest: true };
      }
      if (typeOf(id) === "workstation" && !up("LOGIC-SVC-DHCP")) {
        return { ok: true, ip: `169.254.${(LEVEL_INDEX[levelOf(id)] || 0) * 10 + 7}.${Number(String(ipOf.get(id)).split(".").pop())}`, vlan: ps.vlan, reason: "no DHCP lease (APIPA)", apipa: true };
      }
    }
    const sw = accessSwitchOf(id);
    if (sw && !up(sw)) return { ok: false, ip: ipOf.get(id), vlan: expectedVlan(id), reason: "access switch down" };
    if (sw && !uplinkUp(sw)) return { ok: true, ip: ipOf.get(id), vlan: expectedVlan(id), reason: "floor isolated from core", isolated: true, sw };
    return { ok: true, ip: ipOf.get(id), vlan: expectedVlan(id), reason: null };
  }

  /* can src reach dst? { ok, hops:[{name, ip, ok}], why } */
  function reach(src, dst) {
    const a = hostNet(src), b = hostNet(dst);
    const hops = [];
    if (!a.ok) return { ok: false, hops, why: "local link: " + a.reason, stage: "local" };
    const swA = accessSwitchOf(src), swB = accessSwitchOf(dst);
    const gwA = a.apipa ? null : `10.${a.vlan}.${LEVEL_INDEX[levelOf(src)] ?? 0}.1`;
    if (a.apipa) return { ok: false, hops, why: "no gateway: the host has a 169.254 address (no DHCP lease)", stage: "local" };
    hops.push({ name: swA ? hostOf.get(swA) || "gateway" : "gateway", ip: gwA, ok: true });
    if (a.guest) return { ok: false, hops, why: "guest VLAN is internet-only: internal subnets are blocked", stage: "policy" };
    const sameSwitch = swA && swA === swB && a.vlan === b.vlan;
    if (!sameSwitch) {
      if (a.isolated) return { ok: false, hops, why: "the floor switch has no working uplink to the core", stage: "uplink" };
      if (!coreUp()) return { ok: false, hops, why: "core switch stack down", stage: "core" };
      hops.push({ name: "b1-core-sw01", ip: "10.10.0.1", ok: true });
      if (swB && swB !== swA && typeOf(swB) === "access_switch") {
        if (!up(swB)) return { ok: false, hops, why: "destination floor switch down", stage: "remote-switch" };
        if (!uplinkUp(swB)) return { ok: false, hops, why: "destination floor isolated from core", stage: "remote-uplink" };
        hops.push({ name: hostOf.get(swB), ip: ipOf.get(swB), ok: true });
      }
    }
    if (!b.ok) return { ok: false, hops, why: "destination: " + b.reason, stage: "remote" };
    hops.push({ name: hostOf.get(dst), ip: b.ip, ok: true });
    return { ok: true, hops, why: null };
  }

  /* name/IP/asset-id -> asset id (dns: true when the answer needed DNS) */
  function resolve(token) {
    if (!token) return null;
    const t = String(token).trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(t)) return byIp.has(t) ? { id: byIp.get(t), dns: false } : { id: null, ip: t, dns: false };
    const bare = t.toLowerCase().replace(new RegExp("\\." + DOMAIN.replace(".", "\\.") + "$"), "");
    if (hosts.has(bare)) return { id: hosts.get(bare), dns: true };
    const upper = t.toUpperCase();
    if (assets.has(upper) && hostOf.has(upper)) return { id: upper, dns: false };
    return null;
  }

  function deviceStatus(id) {
    const s = st(id);
    const h = hostNet(id);
    return { id, host: hostOf.get(id) || null, ip: h.ip, availability: s ? s.availability : "unknown", flags: s ? s.condition_flags : [], faults: s ? s.active_fault_ids : [], reachable: h.ok && !h.isolated, reason: h.reason };
  }

  const cameras = () => [...assets.keys()].filter((id) => typeOf(id) === "camera").sort();
  const switches = () => [...assets.keys()].filter((id) => typeOf(id) === "access_switch").sort();
  const ofType = (t) => [...assets.keys()].filter((id) => typeOf(id) === t && !id.includes("::")).sort();

  /* a camera is "recording" when it is up, its path to the NVR works, and the VMS service is up */
  function cameraFeed(id) {
    const d = deviceStatus(id);
    if (d.availability === "unavailable" || !d.reachable) return { state: "no-signal", reason: d.reason || d.flags[0] || "offline", device: d };
    if (!up("B1-SEC-NVR-01")) return { state: "not-recording", reason: "recorder b1-nvr01 unreachable: " + ((st("B1-SEC-NVR-01") || {}).condition_flags || [])[0], device: d };
    const r = reach(id, "B1-SEC-NVR-01");
    if (!r.ok) return { state: "no-signal", reason: r.why, device: d };
    if (!up("LOGIC-SVC-VMS")) return { state: "not-recording", reason: "VMS service down", device: d };
    if (d.availability === "degraded") return { state: "degraded", reason: d.flags[0] || "degraded", device: d };
    return { state: "live", reason: null, device: d };
  }

  return {
    ss, assets, typeOf, levelOf, hostOf, hosts, ipOf, byIp, portTables, endpointPort, svcHost,
    expectedVlan, portStatus, accessSwitchOf, hostNet, reach, resolve, deviceStatus, cameras, switches, ofType, cameraFeed, up, coreUp, uplinkUp,
    WRONG_VLAN, SERVICE_IP,
  };
}
