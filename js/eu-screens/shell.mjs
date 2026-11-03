/* Equity Uprise screens — the sandboxed shell behind every terminal in the building.

   A command parser over ScreenSandbox + the derived network (net.mjs). It reads and changes SANDBOX state only:
   every change goes through ScreenSandbox.inject / clearFor, which replay the canonical ElectronicsSandbox. There is
   no network, no eval and no live control anywhere in this file. Deterministic for a given clock.

   Contexts: bash (workstations, servers, NOC jump host), ios (switches, firewalls, routers), bmc, ups. */

import { createNet, SERVICE_UNITS, SERVICE_FAULT_UNIT, DOMAIN } from "./net.mjs";
import { MAN } from "./man.mjs";
import { MODE_LABELS } from "./contract.mjs";

const L = (t, c = "") => ({ t: String(t), c });
const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, Math.max(n, String(s ?? "").length > n ? n : n));
const padc = (s, n) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n - 1) + " " : s.padEnd(n); };
function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const FAULT_HUMAN = {
  port_shutdown: "port administratively down", poe_disabled: "PoE disabled on the port", camera_link_down: "camera link down",
  ap_link_down: "access point link down", wrong_vlan: "port in the wrong VLAN", voice_vlan_wrong: "voice VLAN wrong",
  idf_ups_failure: "rack UPS failed", uplink_down: "uplink down", uplink_a_cut: "backbone fiber cut", igmp_snooping_off: "IGMP snooping off",
  qos_removed: "QoS policy removed", bas_controller_offline: "BAS controller offline", host_down: "host powered off",
  dhcp_service_down: "DHCP service down", dns_service_down: "DNS service down", ntp_service_down: "NTP service down", nas_degraded: "RAID degraded",
};

export function createShell({ ss, screen = null, clock = () => Date.UTC(2026, 10, 3, 14, 0, 0), user = "operator" }) {
  const net = createNet(ss);
  const mode = ss.mode;
  const floor = screen ? screen.floor : "B1";
  const t0 = clock();

  /* ---- contexts */
  function ctxFor(assetId, viaSsh = false) {
    const t = net.typeOf(assetId);
    const host = net.hostOf.get(assetId) || String(assetId).toLowerCase();
    if (["access_switch", "collapsed_core_switch", "firewall", "edge_router"].includes(t)) return { type: "ios", host, asset: assetId, src: assetId, cfg: null, port: null };
    if (t === "rack_ups") return { type: "ups", host, asset: assetId, src: assetId };
    if (["virtualization_host", "nas_storage", "backup_appliance", "vms_nvr"].includes(t)) return { type: "bash", host, asset: assetId, src: assetId, user: "admin", server: true };
    if (t === "workstation") return { type: "bash", host, asset: assetId, src: assetId, user: viaSsh ? "admin" : "staff" };
    return null;
  }
  function rootCtx() {
    const v = screen && screen.app ? screen.app.variant : "noc";
    const a = screen && screen.network_asset_id;
    if (v === "bmc" && a) return { type: "bmc", host: net.hostOf.get(a) + "-bmc", asset: a, src: "B1-NET-CORE-SW-01-I001" };
    if (v === "ups" && a) return ctxFor(a);
    if ((v === "mdf" || v === "idf") && a && ctxFor(a)) return ctxFor(a);
    if (v === "workstation" && a && ctxFor(a)) return ctxFor(a);
    if (v === "bas") return { type: "bash", host: "b1-bas-console", asset: null, src: "B1-BAS-CTRL-01", user: "operator", bas: true };
    return { type: "bash", host: "b1-noc01", asset: null, src: "B1-NET-CORE-SW-01-I001", user: "noc" };
  }
  const stack = [rootCtx()];
  const ctx = () => stack[stack.length - 1];

  function prompt() {
    const c = ctx();
    if (c.type === "ios") return c.host + (c.cfg === "if" ? "(config-if)#" : c.cfg === "config" ? "(config)#" : "#");
    if (c.type === "ups") return "apc@" + c.host + ">";
    if (c.type === "bmc") return "admin@" + c.host + ":~$";
    return (c.user || user) + "@" + c.host + ":~$";
  }

  const now = (offsetSec = 0) => new Date(clock() + offsetSec * 1000);
  const stamp = (d) => d.toISOString().replace("T", " ").slice(0, 19);
  const jstamp = (d) => d.toUTCString().slice(5, 25).replace(/ (\d{4}) /, " ").replace(/^(\d+) (\w+)/, "$2 $1");

  /* ---- change helpers */
  function denyIfReadOnly() {
    if (ss.readOnly) return [L("% WORKPLACE mode is normal operations and read-only here.", "warn"), L("  Open this screen in TRAINING to practise changes (sandbox only).", "dim")];
    return null;
  }
  const evidenceTail = [];
  function remedied(removed, command, what) {
    const out = [];
    if (!removed.length) return out;
    const faults = [...new Set(removed.map((r) => r.fault_id))];
    out.push(L(`[sandbox] restored: ${faults.map((f) => FAULT_HUMAN[f] || f).join(", ")}`, "ok"));
    if (ss.mode === "TRAINING") {
      ss.addEvidence({ at: now().toISOString(), mode: ss.mode, screen_id: screen ? screen.screen_id : null, floor, action: "fix", command, target: what, fault_ids: faults, transcript: evidenceTail.slice(-12), execution_target: "SANDBOX", live_control_allowed: false });
      const tk = ss.ticket(floor);
      if (tk && tk.status === "resolved") {
        out.push(L(""), L("TICKET RESOLVED  " + tk.seed.ticket.title, "ok"));
        if (tk.seed.ticket.success_message) out.push(L("  " + tk.seed.ticket.success_message, "dim"));
        out.push(L("  Verify it yourself (ping / show / status), then head back to the building.", "dim"));
      }
    }
    return out;
  }
  function injected(entry, what) {
    return [L(`[sandbox] fault applied: ${FAULT_HUMAN[entry.fault_id] || entry.fault_id} on ${what}`, "warn")];
  }
  function tryInject(faultId, selectors, what) {
    const deny = denyIfReadOnly(); if (deny) return deny;
    try { return injected(ss.inject(faultId, selectors, "user"), what); }
    catch (e) { return [L("% sandbox refused: " + (e.code || e.message), "err")]; }
  }

  /* ---- target resolution */
  function target(token) {
    const c = ctx();
    if (!token) return null;
    if (c.type === "ios" && /^(gi|te|gigabitethernet|tengigabitethernet)/i.test(token)) {
      const row = findPort(c.asset, token);
      return row ? { id: row.kind === "access" ? row.endpoint : c.asset, row, sw: c.asset } : null;
    }
    const r = net.resolve(token);
    return r && r.id ? { id: r.id } : null;
  }
  function normPort(p) {
    const m = /^(gi|gigabitethernet|te|tengigabitethernet)\s*(\d+\/\d+\/\d+)$/i.exec(String(p).trim());
    if (!m) return null;
    return (/^t/i.test(m[1]) ? "Te" : "Gi") + m[2];
  }
  function findPort(sw, p) { const n = normPort(p); return n ? (net.portTables.get(sw) || []).find((r) => r.port === n) : null; }

  /* ---- commands */
  const C = {};
  const def = (names, ctxs, fn) => { for (const n of [].concat(names)) C[n] = { ctxs, fn }; };
  const ANY = ["bash", "ios", "bmc", "ups"];

  def("help", ANY, () => {
    const c = ctx();
    const lines = [L(`${MODE_LABELS[mode]} mode  ·  ${c.type === "ios" ? "switch CLI" : c.type === "bmc" ? "BMC (out-of-band)" : c.type === "ups" ? "UPS network card" : "Linux shell"} on ${c.host}`, "hi"), L("")];
    const groups = c.type === "ios"
      ? [["inspect", "show interfaces status · show interface <port> · show vlan brief · show power inline · show ip igmp snooping · show mls qos · show logging · show lldp neighbors · show running-config"], ["change", "configure terminal · interface <port> · shutdown / no shutdown · switchport access|voice vlan <id> · power inline auto|never · ip igmp snooping · mls qos · end · write memory"], ["test", "ping <host> · traceroute <host> · cable test|reseat|replace <port>"]]
      : c.type === "bmc" ? [["bmc", "ipmitool sel list · ipmitool sensor · ipmitool chassis status · ipmitool chassis power on|off"]]
      : c.type === "ups" ? [["ups", "ups status · ups selftest · ups replace-battery"]]
      : [["network", "ping · traceroute · nslookup / dig · ip addr / ip route · ifconfig · dhclient -v"], ["services", "systemctl status|restart <unit> · journalctl [-u unit] [-n N]"], ["hardware", "ipmitool -H <host> ... · raid status · ups status <ups> · camera list · vms status · bacnet who-is · cable test|reseat|replace <host>"], ["move", "ssh <host> · exit"]];
    for (const [g, cmds] of groups) lines.push(L(pad(g, 10) + cmds));
    lines.push(L(pad("session", 10) + "ticket · status · alarms · reset · lab start · history · clear · man <topic> · back"), L(""));
    lines.push(L("Start with `man troubleshooting`. Tab completes; Up/Down recalls history.", "dim"));
    return lines;
  });
  def("man", ANY, (a) => {
    const p = MAN[a[0]] || MAN[{ dig: "dig", host: "nslookup", tracert: "traceroute", ifconfig: "ifconfig", ipconfig: "ifconfig", vms: "camera", interface: "configure", conf: "configure", mdadm: "raid" }[a[0]]];
    if (!a[0]) return [L("What manual page do you want? Try `man troubleshooting`.", "warn")];
    if (!p) return [L(`No manual entry for ${a[0]}`, "err")];
    const out = [L(a[0].toUpperCase() + "  —  " + p.summary, "hi"), L(""), L("SYNOPSIS", "acc"), L("  " + p.synopsis), L(""), L("DESCRIPTION", "acc")];
    for (const b of p.body) out.push(L("  " + b));
    if (p.cert) out.push(L(""), L("STUDY", "acc"), L("  " + p.cert, "dim"));
    return out;
  });
  def("clear", ANY, () => ({ clear: true }));
  def("history", ANY, () => ss.session.history.slice(-40).map((h, i, arr) => L(String(ss.session.history.length - arr.length + i + 1).padStart(5) + "  " + h)));
  def("whoami", ["bash", "bmc"], () => [L(ctx().user || "admin")]);
  def("hostname", ANY, () => [L(ctx().host + "." + DOMAIN)]);
  def("date", ANY, () => [L(now().toUTCString())]);
  def("uptime", ["bash"], () => { const m = Math.floor((clock() - t0) / 60000) + 4321; return [L(` ${stamp(now()).slice(11)} up ${Math.floor(m / 1440)} days, ${Math.floor((m % 1440) / 60)}:${String(m % 60).padStart(2, "0")},  1 user,  load average: 0.08, 0.05, 0.01`)]; });
  def("echo", ANY, (a) => [L(a.join(" "))]);
  def(["exit", "logout", "quit"], ANY, () => {
    const c = ctx();
    if (c.type === "ios" && c.cfg) { c.cfg = c.cfg === "if" ? "config" : null; c.port = null; return []; }
    if (stack.length > 1) { stack.pop(); return [L("Connection to " + c.host + " closed.", "dim")]; }
    return { exit: true, lines: [L("logout", "dim")] };
  });
  def(["back", "building"], ANY, () => ({ exit: true, lines: [L("Heading back to the building…", "dim")] }));
  def("end", ["ios"], () => { const c = ctx(); c.cfg = null; c.port = null; return []; });

  def("ticket", ANY, () => {
    if (mode !== "TRAINING") return [L(mode === "MISSION" ? "PRIM3 MISSION: the mission briefing lives in the game. This console shows the mission's sandbox state." : "No ticket: WORKPLACE is normal operations. Open the screen in TRAINING for a guided ticket.", "dim")];
    const tk = ss.ticket(floor);
    if (!tk) return [L("No training ticket is defined for this floor.", "dim")];
    const t = tk.seed.ticket;
    const out = [L(`TICKET ${tk.seed.source_lab_id}  ·  ${tk.status.toUpperCase()}`, tk.status === "resolved" ? "ok" : tk.status === "open" ? "warn" : "dim"), L(t.title, "hi")];
    if (t.reporter) out.push(L("Reported by: " + t.reporter, "dim"));
    if (t.role) out.push(L(t.role));
    out.push(L(""), L(t.issue_report));
    for (const k of t.known || []) out.push(L("  · " + k, "dim"));
    if (t.goal) out.push(L(""), L("Goal: " + t.goal));
    if (tk.status === "cleared" || tk.status === "not-started") out.push(L(""), L("This ticket is closed. `lab start` reopens it.", "dim"));
    return out;
  });
  def("lab", ANY, (a) => {
    if (a[0] === "start") {
      if (mode !== "TRAINING") return [L("lab start works in TRAINING mode only.", "warn")];
      const tk = ss.restartTicket(floor);
      return tk ? [L("[sandbox] ticket opened: " + tk.seed.ticket.title, "warn"), L("Type `ticket` to read it.", "dim")] : [L("No ticket for this floor.", "dim")];
    }
    if (a[0] === "inject") {
      if (mode !== "TRAINING") return [L("lab inject works in TRAINING mode only.", "warn")];
      if (!a[1] || !a[2]) return [L("usage: lab inject <fault_id> <host|asset|selector>", "warn")];
      const t = a[2].startsWith("level:") ? { id: a[2] } : target(a[2]);
      if (!t) return [L("lab: unknown target " + a[2], "err")];
      return tryInject(a[1], [t.id], a[2]);
    }
    return [L("usage: lab start | lab inject <fault_id> <target>", "warn")];
  });
  def("reset", ANY, () => {
    if (ss.readOnly) return [L("WORKPLACE is already the baseline.", "dim")];
    ss.reset();
    return [L(`[sandbox] ${MODE_LABELS[mode]} sandbox reset to the canonical baseline. Other modes are untouched.`, "ok")];
  });
  def("status", ANY, () => {
    const s = ss.summary();
    return [L(`${MODE_LABELS[mode]} · SANDBOX · live control: disabled`, "hi"),
      L(`devices      ${s.asset_availability.available} available  ${s.asset_availability.degraded} degraded  ${s.asset_availability.unavailable} unavailable`),
      L(`connections  ${s.connection_availability.available} up  ${s.connection_availability.degraded} degraded  ${s.connection_availability.unavailable} down`),
      L(`faults       ${ss.entries().length} active in this mode`, ss.entries().length ? "warn" : "ok")];
  });
  def("alarms", ANY, () => {
    const watch = ["access_switch", "collapsed_core_switch", "rack_ups", "wireless_ap", "camera", "vms_nvr", "virtualization_host", "nas_storage", "workstation", "ip_phone", "bas_controller", "av_controller", "av_camera"];
    const rows = [];
    for (const t of watch) for (const id of net.ofType(t)) {
      const d = net.deviceStatus(id);
      if (d.availability === "available" && d.reachable) continue;
      rows.push(L(`${pad(d.availability === "unavailable" || !d.reachable ? "CRIT" : "WARN", 6)}${pad(d.host || id, 18)}${d.availability === "unavailable" ? "unreachable (ICMP / SNMP timeout)" : !d.reachable ? "unreachable from the core" : "degraded"}`, d.availability === "unavailable" || !d.reachable ? "err" : "warn"));
    }
    for (const id of Object.values(SERVICE_UNITS)) if (!net.up(id)) rows.push(L(`${pad("CRIT", 6)}${pad(net.hostOf.get(id), 18)}service check failed`, "err"));
    return rows.length ? [L("SEV   DEVICE            SYMPTOM", "acc"), ...rows.slice(0, 60)] : [L("No alarms. Everything monitored is up.", "ok")];
  });

  /* ---- reachability */
  def("ping", ANY, (a) => {
    const name = a.find((x) => !x.startsWith("-") && !/^\d+$/.test(x) || /^\d+\.\d+\.\d+\.\d+$/.test(x));
    if (!name) return [L("usage: ping <host|ip>", "warn")];
    const ci = a.indexOf("-c"); const count = Math.min(10, Math.max(1, ci >= 0 ? Number(a[ci + 1]) || 4 : ctx().type === "ios" ? 5 : 4));
    const r = net.resolve(name);
    if (!r) return [L(ctx().type === "ios" ? `% Unrecognized host or address, or protocol not running.` : `ping: ${name}: Name or service not known`, "err")];
    if (r.dns && !net.up("LOGIC-SVC-DNS")) return [L(ctx().type === "ios" ? `% Unrecognized host or address, or protocol not running.` : `ping: ${name}: Temporary failure in name resolution`, "err"), L("hint: names need DNS; try the IP address", "dim")];
    if (!r.id) return [L(`PING ${r.ip} (${r.ip}) 56(84) bytes of data.`), L(`From ${r.ip} icmp_seq=1 Destination Host Unreachable`, "err")];
    const dst = r.id, ip = net.hostNet(dst).ip || net.ipOf.get(dst);
    const res = net.reach(ctx().src, dst);
    const base = 0.3 + (hash(dst) % 900) / 1000;
    if (ctx().type === "ios") {
      return [L("Type escape sequence to abort."), L(`Sending ${count}, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`), L((res.ok ? "!" : ".").repeat(count), res.ok ? "ok" : "err"),
        L(`Success rate is ${res.ok ? 100 : 0} percent (${res.ok ? count : 0}/${count})${res.ok ? `, round-trip min/avg/max = 1/${Math.max(1, Math.round(base * 2))}/4 ms` : ""}`, res.ok ? "" : "err")];
    }
    const out = [L(`PING ${net.hostOf.get(dst)}.${DOMAIN} (${ip}) 56(84) bytes of data.`)];
    for (let i = 1; i <= count; i++) {
      if (res.ok) out.push(L(`64 bytes from ${ip}: icmp_seq=${i} ttl=${64 - res.hops.length + 1} time=${(base + ((hash(dst + i) % 300) / 1000)).toFixed(2)} ms`));
      else if (res.stage === "local") { if (i === 1) out.push(L(`connect: Network is unreachable (${res.why})`, "err")); }
      else out.push(L(`From ${res.hops.length ? res.hops[res.hops.length - 1].ip : "local"} icmp_seq=${i} Destination Host Unreachable`, "err"));
    }
    out.push(L(""), L(`--- ${net.hostOf.get(dst)}.${DOMAIN} ping statistics ---`), L(`${count} packets transmitted, ${res.ok ? count : 0} received, ${res.ok ? 0 : 100}% packet loss`, res.ok ? "ok" : "err"));
    return out;
  });
  def(["traceroute", "tracert", "tracepath"], ANY, (a) => {
    const r = net.resolve(a[0]);
    if (!r || !r.id) return [L(`traceroute: unknown host ${a[0] || ""}`, "err")];
    if (r.dns && !net.up("LOGIC-SVC-DNS")) return [L(`${a[0]}: Temporary failure in name resolution`, "err")];
    const res = net.reach(ctx().src, r.id);
    const out = [L(`traceroute to ${net.hostOf.get(r.id)}.${DOMAIN} (${net.ipOf.get(r.id)}), 30 hops max, 60 byte packets`)];
    res.hops.forEach((h, i) => out.push(L(` ${i + 1}  ${h.name}.${DOMAIN} (${h.ip})  ${(0.4 + i * 0.3).toFixed(3)} ms  ${(0.5 + i * 0.3).toFixed(3)} ms`)));
    if (!res.ok) { out.push(L(` ${res.hops.length + 1}  * * *`, "err"), L(`    stopped: ${res.why}`, "dim")); }
    return out;
  });
  def(["nslookup", "dig", "host"], ["bash", "ios"], (a, name) => {
    const q = a.find((x) => !x.startsWith("-") && !x.startsWith("+"));
    if (!q) return [L(`usage: ${name} <name>`, "warn")];
    const dnsReach = net.reach(ctx().src, "LOGIC-SVC-DNS");
    if (!dnsReach.ok) return name === "dig" ? [L(`;; communications error to 10.110.0.53#53: timed out`, "err"), L(";; no servers could be reached", "err")] : [L(";; connection timed out; no servers could be reached", "err")];
    const r = net.resolve(q);
    const fq = q.replace(new RegExp("\\." + DOMAIN.replace(".", "\\.") + "$"), "") + "." + DOMAIN;
    if (!r || !r.id) return name === "dig" ? [L(`;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN`), L(`;; QUESTION SECTION:`), L(`;${fq}.\t\tIN\tA`)] : [L("Server:\t\t10.110.0.53"), L("Address:\t10.110.0.53#53"), L(""), L(`** server can't find ${fq}: NXDOMAIN`, "err")];
    const ip = net.ipOf.get(r.id);
    if (name === "host") return [L(`${fq} has address ${ip}`)];
    if (name === "dig") return [L(`;; ->>HEADER<<- opcode: QUERY, status: NOERROR`), L(";; ANSWER SECTION:"), L(`${fq}.\t300\tIN\tA\t${ip}`, "ok"), L(`;; SERVER: 10.110.0.53#53(ns1.${DOMAIN})`)];
    return [L("Server:\t\t10.110.0.53"), L("Address:\t10.110.0.53#53"), L(""), L(`Name:\t${fq}`), L(`Address: ${ip}`, "ok")];
  });

  /* ---- local interface */
  function localIf() {
    const c = ctx();
    const src = c.src;
    const h = net.hostNet(src);
    const lv = net.levelOf(src) || "B1";
    return { h, lv, mac: "52:54:00:" + [hash(src) & 255, (hash(src) >> 8) & 255, (hash(src) >> 16) & 255].map((x) => x.toString(16).padStart(2, "0")).join(":") };
  }
  def("ip", ["bash"], (a) => {
    const sub = (a[0] || "addr").toLowerCase();
    const { h, mac } = localIf();
    const link = h.ok || h.apipa || h.guest;
    if (sub.startsWith("a")) {
      return [L("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN"), L("    inet 127.0.0.1/8 scope host lo"),
        L(`2: eth0: <BROADCAST,MULTICAST${link ? ",UP,LOWER_UP" : ",NO-CARRIER"}> mtu 1500 state ${link ? "UP" : "DOWN"}`, link ? "" : "err"),
        L(`    link/ether ${mac} brd ff:ff:ff:ff:ff:ff`),
        ...(link && h.ip ? [L(`    inet ${h.ip}/24 ${h.apipa ? "scope link" : "brd " + h.ip.replace(/\.\d+$/, ".255") + " scope global dynamic"} eth0`, h.apipa || h.guest ? "warn" : "ok")] : [])];
    }
    if (sub.startsWith("r")) {
      if (!link || !h.ip) return [L("(no routes: link is down)", "err")];
      if (h.apipa) return [L("169.254.0.0/16 dev eth0 proto kernel scope link"), L("(no default route: DHCP never answered)", "warn")];
      const gw = h.ip.replace(/\.\d+$/, ".1");
      return [L(`default via ${gw} dev eth0 proto dhcp metric 100`), L(`${h.ip.replace(/\.\d+$/, ".0")}/24 dev eth0 proto kernel scope link src ${h.ip}`)];
    }
    if (sub.startsWith("l")) return [L(`2: eth0: <BROADCAST,MULTICAST${link ? ",UP,LOWER_UP" : ",NO-CARRIER"}> mtu 1500 state ${link ? "UP" : "DOWN"}`, link ? "ok" : "err")];
    return [L('Object "' + sub + '" is unknown, try "ip help".', "err")];
  });
  def(["ifconfig", "ipconfig"], ["bash"], (a, name) => {
    if (name === "ipconfig" && /renew/i.test(a.join(" "))) return C.dhclient.fn(["-v"], "dhclient");
    const { h, mac } = localIf();
    const link = h.ok || h.apipa || h.guest;
    const out = [L(`eth0: flags=${link ? "4163<UP,BROADCAST,RUNNING,MULTICAST>" : "4099<UP,BROADCAST,MULTICAST>"}  mtu 1500`, link ? "" : "err")];
    if (link && h.ip) out.push(L(`        inet ${h.ip}  netmask 255.255.255.0  broadcast ${h.ip.replace(/\.\d+$/, ".255")}`, h.apipa || h.guest ? "warn" : "ok"));
    out.push(L(`        ether ${mac}  txqueuelen 1000  (Ethernet)`));
    if (name === "ipconfig") out.push(L("(ipconfig is the Windows name; this console is Linux: `ip addr` is the native form)", "dim"));
    return out;
  });
  def("dhclient", ["bash"], () => {
    const { h, mac } = localIf();
    if (!(h.ok || h.apipa || h.guest)) return [L("Listening on LPF/eth0/" + mac), L("eth0: link is down: no carrier", "err")];
    const out = [L("Listening on LPF/eth0/" + mac), L("Sending on   LPF/eth0/" + mac)];
    if (!net.up("LOGIC-SVC-DHCP")) { for (const s of [3, 7, 13]) out.push(L(`DHCPDISCOVER on eth0 to 255.255.255.255 port 67 interval ${s}`)); out.push(L("No DHCPOFFERS received.", "err"), L("hint: who answers DHCP here? `nslookup dhcp1` then `ssh b1-hyp01`", "dim")); return out; }
    out.push(L("DHCPDISCOVER on eth0 to 255.255.255.255 port 67 interval 3"), L(`DHCPOFFER of ${h.ip} from ${h.guest ? "10.40.0.1" : "10.110.0.67"}`), L(`DHCPREQUEST for ${h.ip} on eth0 to 255.255.255.255 port 67`), L(`DHCPACK of ${h.ip}`), L(`bound to ${h.ip} -- renewal in 43200 seconds.`, h.guest ? "warn" : "ok"));
    if (h.guest) out.push(L("note: 10.40.x is the GUEST VLAN — this port is in the wrong VLAN for a staff machine", "warn"));
    return out;
  });

  /* ---- services */
  function hostedUnits(assetId) {
    const contained = (ss.sandbox.containedAssets.get(assetId) || []);
    return Object.entries(SERVICE_UNITS).filter(([, id]) => contained.includes(id)).map(([u]) => u);
  }
  def("systemctl", ["bash"], (a) => {
    const verb = a[0], unit = (a[1] || "").replace(/\.service$/, "");
    if (!verb) return [L("usage: systemctl status|restart|start|stop <unit>", "warn")];
    const c = ctx();
    const units = c.server ? hostedUnits(c.asset) : [];
    if (verb === "list-units" || verb === "list") return units.length ? units.map((u) => L(`${pad(u + ".service", 26)}${net.up(SERVICE_UNITS[u]) ? "loaded active running" : "loaded failed failed"}`, net.up(SERVICE_UNITS[u]) ? "" : "err")) : [L("0 units listed on this machine.", "dim")];
    if (!unit) return [L("systemctl: unit name required", "err")];
    if (!units.includes(unit)) {
      const where = Object.keys(SERVICE_UNITS).includes(unit) ? [...ss.sandbox.containedAssets.entries()].find(([, v]) => v.includes(SERVICE_UNITS[unit])) : null;
      return [L(`Unit ${unit}.service could not be found.`, "err"), ...(where ? [L(`hint: ${unit} runs on ${net.hostOf.get(where[0])} — ssh there first`, "dim")] : [])];
    }
    const id = SERVICE_UNITS[unit];
    const s = ss.state(id);
    if (verb === "status") {
      const up = net.up(id);
      return [L(`● ${unit}.service - ${ss.sandbox.assetsById.get(id).label}`, up ? "ok" : "err"),
        L(`     Loaded: loaded (/usr/lib/systemd/system/${unit}.service; enabled)`),
        L(`     Active: ${up ? "active (running) since " + stamp(now(-86400 * 3)) : "failed (Result: exit-code) since " + stamp(now(-420))}`, up ? "ok" : "err"),
        L(`   Main PID: ${up ? 1000 + (hash(unit) % 8000) : "(code=exited, status=1/FAILURE)"}`),
        ...(s && s.condition_flags.length ? [L(`   Sandbox:  ${s.condition_flags.join(", ")}`, "dim")] : [])];
    }
    if (verb === "restart" || verb === "start") {
      const deny = denyIfReadOnly(); if (deny) return deny;
      const faults = Object.entries(SERVICE_FAULT_UNIT).filter(([, u]) => u === unit).map(([f]) => f).concat(["radius_policy_error", "radius_cert_expired", "vpn_auth_failure"]);
      const removed = ss.clearFor(faults, { assetIds: [id] });
      return [...(removed.length ? [] : [L(net.up(id) ? `${unit}.service restarted (it was already running).` : `Job for ${unit}.service failed. See "journalctl -u ${unit}".`, net.up(id) ? "dim" : "err")]), ...remedied(removed, `systemctl ${verb} ${unit}`, unit)];
    }
    if (verb === "stop") {
      const f = Object.entries(SERVICE_FAULT_UNIT).find(([, u]) => u === unit);
      if (!f) return [L(`The sandbox models stopping dhcpd, named and chronyd only.`, "warn")];
      return tryInject(f[0], [id], unit);
    }
    return [L(`Unknown command verb ${verb}.`, "err")];
  });
  def("journalctl", ["bash"], (a) => {
    const ui = a.indexOf("-u"); const unit = ui >= 0 ? (a[ui + 1] || "").replace(/\.service$/, "") : null;
    const ni = a.indexOf("-n"); const n = ni >= 0 ? Math.min(80, Number(a[ni + 1]) || 20) : 20;
    const errOnly = a.includes("-p") && /err/.test(a[a.indexOf("-p") + 1] || "");
    const lines = [];
    let k = 0;
    const H = ctx().host;
    lines.push({ s: -3600, t: `${H} systemd[1]: Started Daily rotation of log files.`, c: "" });
    for (const e of ss.entries()) {
      k++;
      const ids = (e.targets || []).slice(0, 4);
      for (const id of ids) {
        const host = net.hostOf.get(id); if (!host) continue;
        const svcUnit = Object.entries(SERVICE_UNITS).find(([, v]) => v === id);
        if (unit && (!svcUnit || svcUnit[0] !== unit)) continue;
        if (svcUnit) lines.push({ s: -600 + k * 7, t: `${H} systemd[1]: ${svcUnit[0]}.service: Main process exited, code=exited, status=1/FAILURE`, c: "err" }, { s: -599 + k * 7, t: `${H} systemd[1]: ${svcUnit[0]}.service: Failed with result 'exit-code'.`, c: "err" });
        else if (!unit) lines.push({ s: -540 + k * 11, t: `${H} snmptrapd[812]: ${host}: linkDown / unreachable (${(ss.state(id) || {}).condition_flags?.[0] || "fault"})`, c: "err" });
      }
    }
    if (!unit) lines.push({ s: -60, t: `${H} sshd[2231]: Accepted publickey for ${ctx().user || "admin"} from 10.10.0.20 port 50122 ssh2`, c: "" });
    const shown = lines.filter((l) => !errOnly || l.c === "err").sort((x, y) => x.s - y.s).slice(-n);
    return shown.length ? shown.map((l) => L(`${jstamp(now(l.s))} ${l.t}`, l.c)) : [L("-- No entries --", "dim")];
  });

  /* ---- BMC */
  def("ipmitool", ["bash", "bmc"], (a) => {
    let hostId = ctx().type === "bmc" ? ctx().asset : null;
    const hi = a.indexOf("-H");
    if (hi >= 0) { const r = net.resolve(String(a[hi + 1] || "").replace(/-bmc$/, "")); hostId = r && r.id; a = a.filter((_, i) => i !== hi && i !== hi + 1); }
    a = a.filter((x, i, arr) => !["-I", "-U", "-P"].includes(x) && !["-I", "-U", "-P"].includes(arr[i - 1]));
    if (!hostId || !["virtualization_host", "nas_storage", "backup_appliance"].includes(net.typeOf(hostId))) return [L("usage: ipmitool -H <b1-hyp01|b1-hyp02|b1-hyp03|b1-nas01|b1-bkp01> sel list | sensor | chassis status | chassis power on|off", "warn")];
    const off = ss.has(hostId, "host_down");
    const h = net.hostOf.get(hostId);
    const sub = a.join(" ");
    if (/^sel( list)?/.test(sub)) {
      const out = [L(`   1 | ${stamp(now(-86400 * 9)).replace(" ", " | ")} | System Event | OEM System boot event | Asserted`)];
      if (off) out.push(L(`   2 | ${stamp(now(-480)).replace(" ", " | ")} | System ACPI Power State | S5/G2: soft-off | Asserted`, "err"));
      if (ss.has(hostId, "nas_degraded")) out.push(L(`   2 | ${stamp(now(-900)).replace(" ", " | ")} | Drive Slot #3 | Drive Fault | Asserted`, "err"));
      return out;
    }
    if (/^(sensor|sdr)/.test(sub)) {
      const fan = off ? 0 : 6800 + (hash(h) % 900);
      return [["Inlet Temp", off ? "21.000" : (23 + (hash(h) % 5)).toFixed(3), "degrees C", "ok"], ["CPU1 Temp", off ? "na" : (51 + (hash(h + "c") % 9)).toFixed(3), "degrees C", off ? "na" : "ok"], ["FAN1", off ? "0.000" : fan.toFixed(3), "RPM", off ? "na" : "ok"], ["PSU1 Status", "0x01", "discrete", "ok"], ["PSU2 Status", "0x01", "discrete", "ok"], ["Drive Slot 3", ss.has(hostId, "nas_degraded") ? "0x02" : "0x01", "discrete", ss.has(hostId, "nas_degraded") ? "cr" : "ok"]]
        .map(([n, v, u, s]) => L(`${pad(n, 17)}| ${pad(v, 10)}| ${pad(u, 11)}| ${s}`, s === "ok" ? "" : "err"));
    }
    if (/^chassis status/.test(sub)) return [L(`System Power         : ${off ? "off" : "on"}`, off ? "err" : "ok"), L("Power Overload       : false"), L("Main Power Fault     : false"), L(`Last Power Event     : ${off ? "command" : ""}`)];
    if (/^chassis power (on|up)/.test(sub)) {
      const deny = denyIfReadOnly(); if (deny) return deny;
      const removed = ss.clearFor(["host_down"], { assetIds: [hostId] });
      return [L("Chassis Power Control: Up/On"), ...remedied(removed, "ipmitool chassis power on", h)];
    }
    if (/^chassis power (off|soft|cycle|reset)/.test(sub)) {
      if (/cycle|reset/.test(sub)) return [L("Chassis Power Control: Cycle"), L("(host rebooted; sandbox state unchanged)", "dim")];
      return tryInject("host_down", [hostId], h);
    }
    if (/^chassis power status/.test(sub)) return [L(`Chassis Power is ${off ? "off" : "on"}`, off ? "err" : "ok")];
    return [L("ipmitool: subcommands: sel list | sensor | chassis status | chassis power on|off|status", "warn")];
  });

  /* ---- storage */
  def(["raid", "mdadm"], ["bash"], (a, name) => {
    const nas = "B1-SRV-NAS-01";
    const deg = ss.has(nas, "nas_degraded");
    if ((a[0] === "rebuild") || (name === "mdadm" && a.includes("--add"))) {
      if (ctx().asset !== nas) return [L("raid: run this on the array: ssh b1-nas01", "warn")];
      const deny = denyIfReadOnly(); if (deny) return deny;
      const removed = ss.clearFor(["nas_degraded"], { assetIds: [nas] });
      return removed.length ? [L("mdadm: added /dev/sdc (replacement member)"), L("md0: recovery started … recovery done.", "ok"), ...remedied(removed, "raid rebuild", "b1-nas01")] : [L("md0: array is clean; nothing to rebuild.", "dim")];
    }
    if (a[0] === "fail") { if (ctx().asset !== nas) return [L("raid: run this on the array: ssh b1-nas01", "warn")]; return tryInject("nas_degraded", [nas], "b1-nas01 md0"); }
    return [L("md0 : active raid6 sdf[5] sde[4] sdd[3] " + (deg ? "sdc[2](F) " : "sdc[2] ") + "sdb[1] sda[0]"),
      L(`      7813752832 blocks super 1.2 level 6, 512k chunk, algorithm 2 [6/${deg ? 5 : 6}] [${deg ? "UU_UUU" : "UUUUUU"}]`, deg ? "err" : "ok"),
      L(`      state : ${deg ? "clean, degraded" : "clean"}`, deg ? "err" : "ok"), ...(deg ? [L("hint: replace the failed member, then `raid rebuild`", "dim")] : [])];
  });
  def("cat", ["bash"], (a) => a[0] === "/proc/mdstat" ? C.raid.fn([], "raid") : a[0] === "/etc/resolv.conf" ? [L(`search ${DOMAIN}`), L("nameserver 10.110.0.53")] : [L(`cat: ${a[0] || ""}: Permission denied (sandbox console)`, "err")]);

  /* ---- UPS */
  def("ups", ["bash", "ups"], (a) => {
    let id = ctx().type === "ups" ? ctx().asset : null;
    const named = a.slice(1).find((x) => !x.startsWith("-")) || (ctx().type !== "ups" ? a[0] && !["status", "selftest", "replace-battery"].includes(a[0]) && a[0] : null);
    if (named) { const r = net.resolve(named); if (r && r.id && net.typeOf(r.id) === "rack_ups") id = r.id; }
    const verb = ["status", "selftest", "replace-battery", "fail"].includes(a[0]) ? a[0] : "status";
    if (!id) return [L("usage: ups status <b1-ups01|f1-ups01|…>   (or ssh to the UPS)", "warn"), L("UPS units: " + net.ofType("rack_ups").map((x) => net.hostOf.get(x)).join(" "), "dim")];
    const failed = ss.has(id, "idf_ups_failure");
    const h = net.hostOf.get(id);
    if (verb === "status") return [L(`APC      : 001,036,0886`), L(`UPSNAME  : ${h}`), L(`STATUS   : ${failed ? "ONBATT LOWBATT COMMLOST → OFF" : "ONLINE"}`, failed ? "err" : "ok"), L(`LINEV    : ${failed ? "0.0" : "121.5"} Volts`), L(`BCHARGE  : ${failed ? "0.0" : "100.0"} Percent`, failed ? "err" : ""), L(`TIMELEFT : ${failed ? "0.0" : "41.3"} Minutes`), L(`SELFTEST : ${failed ? "BT (battery failed)" : "OK"}`, failed ? "err" : ""), L(`LOAD     : ${failed ? "0" : "38"}% → ${net.hostOf.get(`${net.levelOf(id)}-NET-ACCESS-SW-01`) || "switch"}`)];
    if (verb === "selftest") return failed ? [L("Self-test started… result: BATTERY FAILED. Replace battery module.", "err")] : [L("Self-test started… result: OK", "ok")];
    if (verb === "fail") return tryInject("idf_ups_failure", [id], h);
    const deny = denyIfReadOnly(); if (deny) return deny;
    const removed = ss.clearFor(["idf_ups_failure"], { assetIds: [id] });
    return removed.length ? [L("Battery module replaced. Output restored; load transferred back to UPS.", "ok"), ...remedied(removed, "ups replace-battery", h)] : [L("Battery tests OK; no replacement needed.", "dim")];
  });

  /* ---- cameras / VMS */
  def(["camera", "vms"], ["bash"], (a, name) => {
    const sub = name === "vms" ? "status" : a[0] || "list";
    if (name === "vms" || sub === "recorder") {
      const nvrUp = net.up("B1-SEC-NVR-01"), svc = net.up("LOGIC-SVC-VMS");
      const cams = net.cameras().map((c) => net.cameraFeed(c));
      return [L(`VMS recorder b1-nvr01 : ${nvrUp ? "online" : "OFFLINE"}`, nvrUp ? "ok" : "err"), L(`vms.service            : ${svc ? "running" : "failed"}`, svc ? "ok" : "err"), L(`cameras recording      : ${cams.filter((c) => c.state === "live" || c.state === "degraded").length}/${cams.length}`, cams.every((c) => c.state === "live") ? "ok" : "warn")];
    }
    if (sub === "list") return [L("CAMERA     FLOOR IP            FEED", "acc"), ...net.cameras().map((c) => { const f = net.cameraFeed(c); return L(`${pad(net.hostOf.get(c), 11)}${pad(net.levelOf(c), 6)}${pad(f.device.ip, 14)}${f.state.toUpperCase()}${f.reason ? "  (" + f.reason + ")" : ""}`, f.state === "live" ? "" : "err"); })];
    const r = net.resolve(a[1] || a[0]);
    if (!r || net.typeOf(r.id) !== "camera") return [L("usage: camera list | camera status <f2-cam01>", "warn")];
    const f = net.cameraFeed(r.id), p = net.endpointPort.get(r.id);
    return [L(`${net.hostOf.get(r.id)}  ${f.state.toUpperCase()}`, f.state === "live" ? "ok" : "err"), L(`  switch port : ${p ? net.hostOf.get(p.switchId) + " " + p.port : "unknown"}`), L(`  VLAN        : 70 (CCTV)`), L(`  reason      : ${f.reason || "—"}`)];
  });

  /* ---- BACnet */
  def("bacnet", ["bash"], (a) => {
    const ctrls = net.ofType("bas_controller");
    if (a[0] === "who-is" || !a[0]) return [L("Sending Who-Is to 10.90.0.255 (BACnet/IP UDP 47808)"), ...ctrls.filter((c) => net.up(c)).map((c, i) => L(`I-Am  device ${3000 + i}  ${pad(net.hostOf.get(c), 10)} ${net.ipOf.get(c)}`)), L(`${ctrls.filter((c) => net.up(c)).length} of ${ctrls.length} controllers answered`, ctrls.every((c) => net.up(c)) ? "ok" : "warn")];
    const r = net.resolve(a[1]);
    if (!r || net.typeOf(r.id) !== "bas_controller") return [L("usage: bacnet who-is | bacnet read <l7-bas01> | bacnet reinit <l7-bas01>", "warn")];
    const h = net.hostOf.get(r.id);
    if (a[0] === "read") return net.up(r.id) ? [L(`${h}: system-status = operational`, "ok"), L(`${h}: present-value (zone temp) = ${(70 + (hash(h) % 5)).toFixed(1)} °F`)] : [L(`${h}: APDU timeout — no response`, "err")];
    if (a[0] === "reinit") {
      const deny = denyIfReadOnly(); if (deny) return deny;
      const removed = ss.clearFor(["bas_controller_offline"], { assetIds: [r.id] });
      return [L(`ReinitializeDevice (warmstart) -> ${h}: ${removed.length ? "Simple-ACK" : "Simple-ACK (already operational)"}`), ...remedied(removed, `bacnet reinit ${h}`, h)];
    }
    if (a[0] === "offline") return tryInject("bas_controller_offline", [r.id], h);
    return [L("bacnet: who-is | read | reinit", "warn")];
  });

  /* ---- physical layer */
  def("cable", ANY, (a) => {
    const verb = a[0];
    if (!["test", "reseat", "replace"].includes(verb) || !a[1]) return [L("usage: cable test|reseat|replace <host|port>", "warn")];
    const c = ctx();
    let endpoint = null, links = [], sw = null, uplinkRow = null;
    if (c.type === "ios" && normPort(a[1])) {
      const row = findPort(c.asset, a[1]); if (!row) return [L(`% Invalid interface ${a[1]}`, "err")];
      sw = c.asset; links = row.links; if (row.kind === "access") endpoint = row.endpoint; else uplinkRow = row;
    } else {
      const r = net.resolve(a[1]); if (!r || !r.id) return [L(`cable: unknown target ${a[1]}`, "err")];
      endpoint = r.id; const p = net.endpointPort.get(endpoint);
      if (p) { sw = p.switchId; links = (net.portTables.get(sw).find((x) => x.port === p.port) || {}).links || []; }
      if (net.typeOf(r.id) === "access_switch") { sw = r.id; endpoint = null; uplinkRow = (net.portTables.get(sw) || []).find((x) => x.kind === "uplink"); links = uplinkRow ? uplinkRow.links : []; }
    }
    const linkFaults = ["camera_link_down", "ap_link_down", "open_pair", "reversed_pair", "split_pair", "marginal_termination", "polarity_reversal", "connector_loss"];
    if (verb === "test") {
      const bad = links.map((l) => ss.connState(l)).find((s) => s && s.availability !== "available");
      const epBad = endpoint && linkFaults.some((f) => ss.has(endpoint, f));
      const fiberCut = uplinkRow && (net.portStatus(sw, uplinkRow).status !== "connected");
      if (fiberCut) return [L(`OTDR ${uplinkRow.port} (OS2): event at ${(40 + (hash(sw) % 30))} m — reflective break. Fiber cut.`, "err")];
      if (bad || epBad) return [L(`TDR ${a[1]}: pair A OPEN at ${(12 + (hash(a[1]) % 60))} m  pair B OK  pair C OK  pair D OPEN`, "err"), L("hint: open pairs = damaged or unseated patch cord/jack", "dim")];
      return [L(`TDR ${a[1]}: all four pairs OK, length ${(18 + (hash(a[1]) % 60))} m`, "ok")];
    }
    const deny = denyIfReadOnly(); if (deny) return deny;
    let removed = [];
    if (endpoint) removed = ss.clearFor(verb === "reseat" ? linkFaults : linkFaults.concat(["uplink_a_cut"]), { assetIds: [endpoint], connectionIds: links });
    if (sw && uplinkRow && verb === "replace") removed = removed.concat(ss.clearFor(["uplink_a_cut", "fiber_bend", "connector_loss"], { assetIds: [sw], connectionIds: links }));
    if (!removed.length) return [L(`${verb === "reseat" ? "Re-seated" : "Replaced"} the cord on ${a[1]}. No change in link state.`, "dim")];
    return [L(`${verb === "reseat" ? "Re-seated and re-terminated" : "Replaced"} ${a[1]}. Link light: green.`, "ok"), ...remedied(removed, `cable ${verb} ${a[1]}`, a[1])];
  });

  /* ---- SSH */
  def("ssh", ["bash", "ios"], (a) => {
    const name = (a.find((x) => !x.startsWith("-")) || "").replace(/^[^@]+@/, "");
    const r = net.resolve(name);
    if (!r || !r.id) return [L(`ssh: Could not resolve hostname ${name}: Name or service not known`, "err")];
    if (r.dns && !net.up("LOGIC-SVC-DNS")) return [L(`ssh: Could not resolve hostname ${name}: Temporary failure in name resolution`, "err")];
    const next = ctxFor(r.id, true);
    if (!next) return [L(`ssh: connect to host ${name} port 22: Connection refused`, "err"), L(`(${net.typeOf(r.id)} is an appliance without a shell: try \`camera status ${name}\` or the device's own screen)`, "dim")];
    const res = net.reach(ctx().src, r.id);
    if (!res.ok) return [L(`ssh: connect to host ${name} port 22: ${res.stage === "local" ? "Network is unreachable" : "No route to host"}`, "err"), L("    " + res.why, "dim")];
    stack.push(next);
    return [L(`Connected to ${net.hostOf.get(r.id)}.${DOMAIN} (${net.ipOf.get(r.id)}).`, "dim"), L(next.type === "ios" ? `${net.hostOf.get(r.id)}: SANDBOX clone · live control disabled` : `Last login: ${now(-7200).toUTCString()} from 10.10.0.20`, "dim")];
  });

  /* ---- IOS */
  function iosOnly(name) { return [L(`bash: ${name}: command not found`, "err"), L(`hint: \`${name}\` is a switch command — ssh to a switch first (e.g. ssh ${net.hostOf.get(`${floor === "L7" ? "F6" : floor}-NET-ACCESS-SW-01`) || "b1-core-sw01"})`, "dim")]; }
  def("show", ANY, (a) => {
    if (ctx().type !== "ios") return iosOnly("show");
    const c = ctx(); const sw = c.asset; const s = a.join(" ").toLowerCase();
    const rows = net.portTables.get(sw) || [];
    const isSwitch = ["access_switch", "collapsed_core_switch"].includes(net.typeOf(sw));
    if (/^(int|interfaces?) status/.test(s) || /^ip int(erface)? br/.test(s)) {
      if (!isSwitch) return [L("Interface      Status   Protocol"), L("Te0/0/0        up       up", "ok"), L("Te0/0/1        up       up", "ok")];
      const out = [L("Port       Name               Status       Vlan       Duplex  Speed  Type", "acc")];
      for (const r of rows) {
        const ps = net.portStatus(sw, r);
        const nm = r.kind === "access" ? (net.hostOf.get(r.endpoint) || "") : r.kind === "unused" ? "" : (net.hostOf.get(r.endpoint) || r.endpoint);
        out.push(L(`${padc(r.port, 11)}${padc(nm, 19)}${padc(ps.status, 13)}${padc(r.kind === "unused" ? 1 : ps.vlan, 11)}${padc(ps.status === "connected" ? "a-full" : "auto", 8)}${padc(ps.status === "connected" ? (r.kind === "access" ? "a-1000" : "10G") : "auto", 7)}${r.kind === "access" || r.kind === "unused" ? "10/100/1000BaseTX" : "SFP-10GBase-LR"}`, ps.status === "connected" || r.kind === "unused" ? "" : ps.status === "disabled" ? "warn" : "err"));
      }
      return out;
    }
    let m;
    if ((m = /^int(erfaces?)? ((gi|te)\S+)/.exec(s))) {
      const r = findPort(sw, m[2]); if (!r) return [L(`% Invalid input detected at '^' marker.`, "err")];
      const ps = net.portStatus(sw, r);
      return [L(`${r.port} is ${ps.status === "disabled" ? "administratively down" : ps.status === "connected" ? "up" : "down"}, line protocol is ${ps.status === "connected" ? "up (connected)" : "down (" + ps.status + ")"}`, ps.status === "connected" ? "ok" : "err"),
        L(`  Description: ${r.kind === "access" ? net.hostOf.get(r.endpoint) : r.kind}`), L(`  Hardware is ${r.kind === "access" ? "Gigabit Ethernet" : "Ten Gigabit Ethernet"}, address is 00a3.d1${String(hash(r.port) % 99).padStart(2, "0")}.${String(hash(sw) % 9999).padStart(4, "0")}`),
        L(`  ${ps.status === "connected" ? "Full-duplex, 1000Mb/s" : "Auto-duplex, Auto-speed"}, media type is ${r.kind === "access" ? "10/100/1000BaseTX" : "SFP-10GBase-LR"}`),
        ...(r.kind === "access" ? [L(`  Access VLAN ${ps.vlan}${ps.voice ? ", voice VLAN " + ps.voice : ""}${ps.poe !== "n/a" ? ", PoE " + ps.poe : ""}`, ps.reason && /vlan/.test(ps.reason) ? "warn" : "")] : []),
        L(`  ${ps.status === "connected" ? 0 : 3 + (hash(r.port) % 40)} input errors, 0 CRC, 0 frame`)];
    }
    if (/^vlan/.test(s)) {
      const by = new Map();
      for (const r of rows.filter((x) => x.kind === "access")) { const ps = net.portStatus(sw, r); if (!by.has(ps.vlan)) by.set(ps.vlan, []); by.get(ps.vlan).push(r.port.replace("Gi1/0/", "Gi1/0/")); }
      const names = { 1: "default", 10: "MGMT", 20: "STAFF", 30: "LAB", 40: "GUEST", 50: "VOICE", 60: "AV", 70: "CCTV", 80: "ACCESS", 90: "BAS-OT", 100: "IOT", 110: "SERVERS", 120: "PRINTERS", 130: "DMZ" };
      return [L("VLAN Name                             Status    Ports", "acc"), ...Object.entries(names).map(([v, n]) => L(`${pad(v, 5)}${pad(n, 33)}active    ${(by.get(Number(v)) || []).join(", ")}`))];
    }
    if (/^power inline/.test(s)) {
      const out = [L("Interface Admin  Oper       Power   Device", "acc")];
      for (const r of rows.filter((x) => x.kind === "access")) { const ps = net.portStatus(sw, r); if (ps.poe === "n/a") continue; out.push(L(`${pad(r.port, 10)}${pad(ps.poe === "off" ? "off" : "auto", 7)}${pad(ps.poe === "off" ? "off" : ps.status === "connected" ? "on" : "searching", 11)}${pad(ps.poe === "off" || ps.status !== "connected" ? "0.0" : (6 + (hash(r.endpoint) % 90) / 10).toFixed(1), 8)}${net.hostOf.get(r.endpoint)}`, ps.poe === "off" ? "warn" : "")); }
      return out;
    }
    const lv = net.levelOf(sw);
    if (/^ip igmp snoop/.test(s)) { const off = ss.entries().some((e) => e.fault_id === "igmp_snooping_off" && e.level === lv); return [L(`Global IGMP Snooping configuration:`), L(`IGMP snooping              : ${off ? "Disabled" : "Enabled"}`, off ? "err" : "ok"), ...(off ? [L("hint: without snooping, AV multicast floods every port on the VLAN", "dim")] : [])]; }
    if (/^mls qos/.test(s)) { const off = ss.entries().some((e) => e.fault_id === "qos_removed" && e.level === lv); return [L(`QoS is ${off ? "disabled" : "enabled"} globally`, off ? "err" : "ok"), ...(off ? [L("hint: media/AV traffic is no longer prioritized (DSCP not trusted)", "dim")] : [L("  trust dscp on AV and voice ports")])]; }
    if (/^log/.test(s)) {
      const out = [];
      for (const r of rows) { const ps = net.portStatus(sw, r); if (ps.status !== "connected" && r.kind !== "unused") out.push(L(`*${jstamp(now(-300 - (hash(r.port) % 200)))}: %LINK-3-UPDOWN: Interface ${r.port}, changed state to ${ps.status === "disabled" ? "administratively down" : "down"}`, "err")); if (ps.poe === "off") out.push(L(`*${jstamp(now(-310))}: %ILPOWER-5-POWER_DENIED: Interface ${r.port}: inline power disabled (admin)`, "warn")); if (ps.reason === "wrong_vlan" || ps.reason === "voice_vlan_wrong") out.push(L(`*${jstamp(now(-320))}: %SYS-5-CONFIG_I: Configured from console: ${r.port} VLAN changed`, "warn")); }
      return out.length ? out : [L("(log buffer: no recent link events)", "dim")];
    }
    if (/^lldp|^cdp/.test(s)) return [L("Device ID           Local Intf     Hold-time  Capability  Port ID", "acc"), ...rows.filter((r) => r.kind !== "unused" && net.portStatus(sw, r).status === "connected").map((r) => L(`${pad(net.hostOf.get(r.endpoint) || r.endpoint, 20)}${pad(r.port, 15)}${pad(120, 11)}${pad(r.kind === "access" ? "S" : "B,R", 12)}${r.peerPort || "eth0"}`))];
    if (/^run/.test(s)) {
      const out = [L("Building configuration…", "dim"), L(`hostname ${c.host}`), L(lv && ss.entries().some((e) => e.fault_id === "igmp_snooping_off" && e.level === lv) ? "no ip igmp snooping" : "ip igmp snooping"), L(lv && ss.entries().some((e) => e.fault_id === "qos_removed" && e.level === lv) ? "no mls qos" : "mls qos")];
      const only = /int(erface)? ((gi|te)\S+)/.exec(s);
      for (const r of rows.filter((x) => x.kind === "access" && (!only || x.port === normPort(only[2])))) { const ps = net.portStatus(sw, r); out.push(L(`interface ${r.port}`), L(` description ${net.hostOf.get(r.endpoint)}`), L(` switchport access vlan ${ps.vlan}`), ...(ps.voice ? [L(` switchport voice vlan ${ps.voice}`)] : []), ...(ps.poe === "off" ? [L(" power inline never")] : []), ...(ps.status === "disabled" ? [L(" shutdown")] : [])); }
      return out;
    }
    if (/^ver/.test(s)) return [L(`${c.host} — McCluster sandbox switch image 17.9 (simulated)`), L("Execution target: SANDBOX · live control disabled", "dim")];
    return [L("% Incomplete or unknown show command. Try: show interfaces status | show vlan brief | show power inline | show logging", "err")];
  });
  def(["configure", "conf"], ["ios"], (a) => { if (!/^t/.test(a[0] || "t")) return [L("% Invalid input", "err")]; ctx().cfg = "config"; return [L("Enter configuration commands, one per line.  End with CNTL/Z.", "dim")]; });
  def(["interface", "int"], ["ios"], (a) => {
    const c = ctx(); if (!c.cfg) return [L("% Invalid input detected at '^' marker. (enter `configure terminal` first)", "err")];
    const r = findPort(c.asset, a.join("")); if (!r) return [L(`% Invalid interface ${a.join(" ")}`, "err")];
    c.cfg = "if"; c.port = r.port; return [];
  });
  function ifRow() { const c = ctx(); return c.cfg === "if" ? findPort(c.asset, c.port) : null; }
  def(["shutdown", "shut"], ["ios"], () => {
    const r = ifRow(); if (!r) return [L("% Invalid input (select an interface first)", "err")];
    if (r.kind === "access") return tryInject("port_shutdown", [r.endpoint], `${ctx().host} ${r.port}`);
    if (r.kind === "uplink" && r.port === "Te1/1/1") return tryInject("uplink_down", [ctx().asset], `${ctx().host} ${r.port}`);
    return [L("% The sandbox models shutdown on access ports and the primary uplink (Te1/1/1).", "warn")];
  });
  def("no", ["ios"], (a) => {
    const c = ctx(); const s = a.join(" ").toLowerCase(); const lv = net.levelOf(c.asset);
    if (/^shut/.test(s)) {
      const r = ifRow(); if (!r) return [L("% Invalid input (select an interface first)", "err")];
      const deny = denyIfReadOnly(); if (deny) return deny;
      const removed = r.kind === "access" ? ss.clearFor(["port_shutdown"], { assetIds: [r.endpoint] }) : ss.clearFor(["uplink_down"], { assetIds: [c.asset] });
      return removed.length ? [L(`%LINK-3-UPDOWN: Interface ${r.port}, changed state to up`, "ok"), ...remedied(removed, "no shutdown", `${c.host} ${r.port}`)] : [];
    }
    if (/^ip igmp snoop/.test(s)) { if (!c.cfg) return [L("% enter configure terminal first", "err")]; const sel = ss.sandbox.resolveSelector(`level:${lv}:type:av_controller`); if (!sel.resolved) return [L("% no AV system on this floor", "warn")]; return tryInject("igmp_snooping_off", [`level:${lv}:type:av_controller`, `level:${lv}:type:av_camera`].filter((x) => ss.sandbox.resolveSelector(x).resolved), c.host); }
    if (/^mls qos/.test(s)) { if (!c.cfg) return [L("% enter configure terminal first", "err")]; const x = `level:${lv}:type:av_camera`; if (!ss.sandbox.resolveSelector(x).resolved) return [L("% no AV endpoints on this floor", "warn")]; return tryInject("qos_removed", [x, `level:${lv}:type:av_controller`].filter((y) => ss.sandbox.resolveSelector(y).resolved), c.host); }
    if (/^power inline/.test(s)) return C.power.fn(["inline", "auto"], "power");
    return [L("% Invalid input detected", "err")];
  });
  def("switchport", ["ios"], (a) => {
    const r = ifRow(); if (!r || r.kind !== "access") return [L("% Invalid input (select an access interface first)", "err")];
    const kind = a[0], vlan = Number(a[2]);
    if (!["access", "voice"].includes(kind) || a[1] !== "vlan" || !Number.isInteger(vlan)) return [L("% usage: switchport access vlan <id> | switchport voice vlan <id>", "warn")];
    const e = r.endpoint;
    if (kind === "access") {
      const want = net.expectedVlan(e) === 50 ? 20 : net.expectedVlan(e);
      if (net.typeOf(e) === "ip_phone") return vlan === 20 ? [] : tryInject("wrong_vlan", [e], `${ctx().host} ${r.port}`);
      if (vlan === want) { const deny = denyIfReadOnly(); if (deny) return deny; const removed = ss.clearFor(["wrong_vlan"], { assetIds: [e] }); return remedied(removed, `switchport access vlan ${vlan}`, `${ctx().host} ${r.port}`); }
      return tryInject("wrong_vlan", [e], `${ctx().host} ${r.port} (VLAN ${vlan})`);
    }
    if (net.typeOf(e) !== "ip_phone") return [L("% voice VLAN only matters on a phone port", "warn")];
    if (vlan === 50) { const deny = denyIfReadOnly(); if (deny) return deny; const removed = ss.clearFor(["voice_vlan_wrong"], { assetIds: [e] }); return remedied(removed, "switchport voice vlan 50", `${ctx().host} ${r.port}`); }
    return tryInject("voice_vlan_wrong", [e], `${ctx().host} ${r.port}`);
  });
  def("power", ["ios"], (a) => {
    const r = ifRow(); if (!r || r.kind !== "access") return [L("% Invalid input (select an access interface first)", "err")];
    if (a[0] !== "inline" || !["auto", "never", "static"].includes(a[1])) return [L("% usage: power inline auto | never", "warn")];
    if (a[1] === "never") return tryInject("poe_disabled", [r.endpoint], `${ctx().host} ${r.port}`);
    const deny = denyIfReadOnly(); if (deny) return deny;
    const removed = ss.clearFor(["poe_disabled"], { assetIds: [r.endpoint] });
    return removed.length ? [L(`%ILPOWER-5-POWER_GRANTED: Interface ${r.port}: Power granted`, "ok"), ...remedied(removed, "power inline auto", `${ctx().host} ${r.port}`)] : [];
  });
  def("mls", ["ios"], (a) => {
    const c = ctx(); if (!c.cfg) return [L("% Invalid input (configure terminal first)", "err")];
    if (a[0] === "qos") { const deny = denyIfReadOnly(); if (deny) return deny; const removed = ss.clearFor(["qos_removed"], { level: net.levelOf(c.asset) }); return remedied(removed, "mls qos", c.host); }
    return [L("% Invalid input", "err")];
  });
  def(["write", "copy", "wr"], ["ios"], () => [L("Building configuration…"), L("[OK]", "ok")]);
  def("do", ["ios"], (a) => run(a.join(" "), true));

  /* ---- dispatcher */
  const ALIASES = { "?": "help", ll: "ls", sh: "show" };
  function run(line, nested = false) {
    const raw = String(line || "").trim();
    if (!raw) return { lines: [] };
    const parts = raw.match(/"[^"]*"|\S+/g).map((p) => p.replace(/^"|"$/g, ""));
    let name = parts[0].toLowerCase(); name = ALIASES[name] || name;
    const args = parts.slice(1);
    const c = ctx();
    const cmd = C[name];
    /* bash cannot run ip's IOS form and vice versa: pick the right handler by context */
    if (name === "ip" && c.type === "ios") return wrap(C.ip_ios.fn(args, name));
    if (!cmd) {
      if (c.type === "ios") return wrap([L(`% Invalid input detected at '^' marker.  ('${name}' is not a switch command: try \`help\`)`, "err")]);
      if (name === "ls") return wrap([L("notes.txt  runbook.md", "dim")]);
      return wrap([L(`bash: ${name}: command not found`, "err"), L("type `help` to see what this console understands", "dim")]);
    }
    if (!cmd.ctxs.includes(c.type)) {
      if (c.type === "ios") return wrap([L(`% '${name}' is not available on a switch. \`exit\` back to a shell.`, "err")]);
      if (c.type === "bmc" || c.type === "ups") return wrap([L(`${name}: not available on this ${c.type === "bmc" ? "BMC" : "UPS card"} (try \`help\`)`, "err")]);
      return wrap(iosOnly(name));
    }
    let res;
    try { res = cmd.fn(args, name); } catch (e) { res = [L("error: " + (e.message || e), "err")]; }
    return wrap(res);
    function wrap(r) { return Array.isArray(r) ? { lines: r } : { lines: r.lines || [], clear: Boolean(r.clear), exit: Boolean(r.exit) }; }
  }
  /* the IOS `ip` form (global config), kept apart from the Linux `ip` */
  C.ip_ios = { ctxs: ["ios"], fn: (a) => {
    const c = ctx(); if (!c.cfg) return [L("% Invalid input (configure terminal first)", "err")];
    if (/^igmp snoop/.test(a.join(" "))) { const deny = denyIfReadOnly(); if (deny) return deny; const removed = ss.clearFor(["igmp_snooping_off"], { level: net.levelOf(c.asset) }); return remedied(removed, "ip igmp snooping", c.host); }
    return [L("% Unsupported in the sandbox", "warn")];
  } };

  function exec(line) {
    const raw = String(line || "").trim();
    if (raw) { ss.pushHistory(raw); evidenceTail.push(prompt() + " " + raw); }
    const r = run(raw);
    return { ...r, prompt: prompt() };
  }

  /* ---- completion */
  function words() {
    const c = ctx();
    return Object.entries(C).filter(([n, v]) => v.ctxs.includes(c.type) && !n.includes("_")).map(([n]) => n).sort();
  }
  const SUBS = {
    show: ["interfaces status", "interface ", "vlan brief", "power inline", "ip igmp snooping", "mls qos", "logging", "lldp neighbors", "running-config", "version"],
    systemctl: ["status ", "restart ", "start ", "stop ", "list-units"], ipmitool: ["-H ", "sel list", "sensor", "chassis status", "chassis power on", "chassis power off"],
    ups: ["status ", "selftest", "replace-battery"], camera: ["list", "status "], bacnet: ["who-is", "read ", "reinit "], cable: ["test ", "reseat ", "replace "],
    lab: ["start", "inject "], configure: ["terminal"], power: ["inline auto", "inline never"], switchport: ["access vlan ", "voice vlan "], raid: ["status", "rebuild"], ip: ["addr", "route", "link"],
    man: Object.keys(MAN),
  };
  function complete(line) {
    const s = String(line || "");
    const parts = s.split(/\s+/);
    const c = ctx();
    let opts;
    if (parts.length <= 1) opts = words().filter((w) => w.startsWith(parts[0].toLowerCase()));
    else {
      const cmd = parts[0].toLowerCase(), cur = parts[parts.length - 1], before = parts.slice(1, -1).join(" ");
      const sub = (SUBS[cmd] || []).filter((x) => (before ? before + " " : "") === x.slice(0, before.length + (before ? 1 : 0)) || !before).map((x) => before && x.startsWith(before + " ") ? x.slice(before.length + 1) : x);
      const ports = c.type === "ios" ? (net.portTables.get(c.asset) || []).filter((r) => r.kind !== "unused").map((r) => r.port) : [];
      const hostsList = [...net.hosts.keys()];
      const units = Object.keys(SERVICE_UNITS);
      let pool = sub.map((x) => x.split(" ")[0]);
      if (["ping", "ssh", "traceroute", "nslookup", "dig", "host", "tracert"].includes(cmd)) pool = hostsList;
      if (cmd === "systemctl" && parts.length >= 3) pool = units;
      if ((cmd === "interface" || cmd === "int") || (cmd === "show" && /^int/.test(before)) || (cmd === "cable" && parts.length >= 3)) pool = ports.length ? ports.concat(cmd === "cable" ? hostsList : []) : hostsList;
      if ((cmd === "ups" && parts.length >= 3) || (cmd === "camera" && parts.length >= 3) || (cmd === "bacnet" && parts.length >= 3) || (cmd === "ipmitool" && parts[parts.length - 2] === "-H")) pool = hostsList.filter((h) => cmd === "ups" ? /-ups\d/.test(h) : cmd === "camera" ? /-cam\d/.test(h) : cmd === "bacnet" ? /-bas\d/.test(h) : /hyp|nas|bkp/.test(h));
      opts = [...new Set(pool)].filter((w) => w.toLowerCase().startsWith(cur.toLowerCase())).sort();
    }
    if (opts.length === 1) { const p = s.split(/\s+/); p[p.length - 1] = opts[0]; return { line: p.join(" ") + (opts[0].endsWith(" ") ? "" : " "), options: [] }; }
    let common = opts[0] || "";
    for (const o of opts) while (!o.startsWith(common)) common = common.slice(0, -1);
    const p = s.split(/\s+/); const cur = p[p.length - 1];
    if (common.length > cur.length) { p[p.length - 1] = common; return { line: p.join(" "), options: opts }; }
    return { line: s, options: opts.slice(0, 60) };
  }

  function banner() {
    const c = ctx();
    const out = [
      L("EQUITY UPRISE · BUILDING SYSTEMS CONSOLE", "hi"),
      L(`${screen ? screen.label + " · " + screen.floor + " · " + screen.room.label : "Network operations"}`, "dim"),
      L(`mode ${MODE_LABELS[mode].toUpperCase()} · target SANDBOX (digital-twin clone) · live control DISABLED`, mode === "MISSION" ? "err" : mode === "TRAINING" ? "warn" : "acc"),
      L(""),
    ];
    if (mode === "TRAINING") {
      const tk = ss.ticket(floor);
      if (tk && tk.status === "open") out.push(L(`Open ticket: ${tk.seed.ticket.title}`, "warn"), L("Type `ticket` to read it, `man troubleshooting` for the method.", "dim"), L(""));
      else if (tk && tk.status === "resolved") out.push(L(`Ticket resolved: ${tk.seed.ticket.title}`, "ok"), L(""));
    }
    if (mode === "MISSION" && ss.entries().length) out.push(L(`Mission state: ${ss.entries().length} sandbox outage(s) active in this building.`, "err"), L(""));
    if (mode === "WORKPLACE") out.push(L("Normal operations. Read-only: look around with `help`, `alarms`, `ping`.", "dim"), L(""));
    out.push(L(`Connected to ${c.host}. Type \`help\`.`, "dim"));
    return out;
  }

  return { prompt, exec, complete, banner, net, get context() { return { ...ctx() }; }, get depth() { return stack.length; } };
}
