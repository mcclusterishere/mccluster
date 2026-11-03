/* Equity Uprise building screens: registry <-> canonical asset ids, the enter/return contract, the sandboxed shell
   (parser, completion, deterministic sandbox changes, every floor's training ticket resolvable from a console) and
   mode isolation. Pure Node: no browser, no network. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const P = ROOT + "docs/design/equity-uprise-building/production/";
const j = (p) => JSON.parse(readFileSync(p, "utf8"));
const registry = j(ROOT + "screens/data/screen-registry-v1.json");
const destinations = j(ROOT + "screens/data/roof-destination-registry-v1.json");
const assets = j(P + "asset-registry/generated/equity-uprise-asset-registry-v1.json");
const connections = j(P + "electronics/generated/equity-uprise-electronics-connections-v1.json");
const manifest = j(P + "electronics/generated/equity-uprise-electronics-manifest-v1.json");

const contract = await import(ROOT + "js/eu-screens/contract.mjs");
const state = await import(ROOT + "js/eu-screens/state.mjs");
const { ScreenSandbox } = await import(ROOT + "js/eu-screens/sandbox-session.mjs");
const { createShell } = await import(ROOT + "js/eu-screens/shell.mjs");
const { createNet } = await import(ROOT + "js/eu-screens/net.mjs");
const { ElectronicsSandbox } = await import(P + "lab-runtime/equity-uprise-electronics-sandbox.mjs");
const gen = await import(P + "screens/build_screen_registry_v1.mjs");

const sandbox = new ElectronicsSandbox({ registry: assets, connections, manifest });
const byId = new Map(assets.assets.map((a) => [a.asset_id, a]));
const screen = (id) => registry.screens.find((s) => s.screen_id === id);
const CLOCK = () => Date.UTC(2026, 10, 3, 14, 0, 0);
function memStore() { const m = {}; return { load: (k) => m[k] && JSON.parse(m[k]), save: (k, s) => { m[k] = JSON.stringify(s); return JSON.parse(m[k]); } }; }
function session(mode, storage = memStore()) { return new ScreenSandbox({ sandbox, screens: registry, mode, storage }); }
function drive(ss, screenId, cmds) {
  const sh = createShell({ ss, screen: screen(screenId), clock: CLOCK });
  return cmds.map((c) => { const r = sh.exec(c); return r.lines.map((l) => l.t).join("\n"); }).join("\n");
}

/* ---------------------------------------------------------------- registry */
test("published registry is byte-identical to a fresh generation", () => {
  assert.equal(JSON.stringify(gen.buildScreenRegistry(), null, 2) + "\n", readFileSync(ROOT + "screens/data/screen-registry-v1.json", "utf8"));
  assert.equal(readFileSync(ROOT + "screens/data/screen-registry-v1.json", "utf8"), readFileSync(P + "screens/equity-uprise-screen-registry-v1.json", "utf8"));
  assert.equal(JSON.stringify(gen.buildDestinationRegistry(), null, 2) + "\n", readFileSync(ROOT + "screens/data/roof-destination-registry-v1.json", "utf8"));
});

test("every screen binds to a canonical asset id and a sane position", () => {
  const ids = new Set();
  for (const s of registry.screens) {
    assert.ok(!ids.has(s.screen_id), "unique " + s.screen_id); ids.add(s.screen_id);
    assert.equal(s.screen_id, "SCR-" + s.asset_id);
    const a = byId.get(s.asset_id);
    assert.ok(a, "asset exists: " + s.asset_id);
    assert.equal(a.location.level_id, s.floor, "floor matches asset: " + s.asset_id);
    if (s.network_asset_id) assert.ok(byId.has(s.network_asset_id), "network asset exists: " + s.network_asset_id);
    assert.ok(s.position.x >= 0 && s.position.x <= 72 && s.position.y >= 0 && s.position.y <= 72, "inside the plate: " + s.screen_id);
    assert.equal(s.position.frame, "core-v2-local-ft");
    assert.ok(registry.apps[s.app.id], "known app " + s.app.id);
    assert.deepEqual(s.modes, registry.apps[s.app.id].modes);
    assert.equal(s.access.live_control_allowed, false);
    assert.equal(s.access.control_target, "SANDBOX");
    if (s.floor === "B1") assert.equal(s.access.level, "open", "B1 is open/normal (owner)");
  }
  assert.equal(registry.screen_count, registry.screens.length);
});

test("the registry covers every kind of display surface the building has", () => {
  const kinds = new Set(registry.screens.map((s) => s.kind));
  for (const k of ["workstation_monitor", "wall_display", "kiosk", "checkin_terminal", "reception_console", "security_console", "noc_wall", "noc_console", "rack_console", "bmc_console", "studio_console", "evidence_terminal", "command_display", "portal_board", "portal_terminal", "vms_console"]) assert.ok(kinds.has(k), "kind " + k);
  for (const f of ["B1", "F1", "F2", "F3", "F4", "F5", "F6", "L7"]) assert.ok(registry.screens.some((s) => s.floor === f), "screens on " + f);
  for (const t of ["monitor", "interactive_terminal", "vms_nvr", "virtualization_host", "collapsed_core_switch", "rack_ups"]) {
    for (const a of assets.assets.filter((x) => x.classification.asset_type === t && !x.asset_id.includes("::") && x.location.level_id !== "BUILDING")) assert.ok(screen("SCR-" + a.asset_id), `every ${t} has a screen: ${a.asset_id}`);
  }
  assert.ok(screen("SCR-F1-RECEPTION-MONITOR-01").app.id === "kiosk");
  assert.ok(screen("SCR-F6-DISPLAY-NOW").kind === "command_display");
  assert.ok(screen("SCR-F7-ECOSYSTEM-DISPLAY-01").app.id === "departures");
});

test("roof destinations are data from the domain architecture, https only", () => {
  const arch = j(ROOT + "data/seo/domain-architecture.json");
  assert.deepEqual(destinations.destinations.map((d) => d.id).sort(), Object.keys(arch.properties).sort());
  for (const d of destinations.destinations) {
    assert.match(d.url, /^https:\/\//);
    assert.equal(new URL(d.url).origin, arch.properties[d.id].origin);
    for (const k of ["id", "display_name", "url", "scene_id", "arrival_route", "departure_asset", "arrival_asset", "access", "enabled", "return_route", "metadata"]) assert.ok(k in d, "contract field " + k);
  }
  const src = readFileSync(ROOT + "js/eu-screens/apps/departures.mjs", "utf8");
  for (const d of destinations.destinations) assert.ok(!src.includes(new URL(d.url).host), "no hardcoded destination host in the board: " + d.url);
});

/* ---------------------------------------------------------------- contract */
test("enter/return URL round trip", () => {
  const rp = { href: "/screens/building.html", floor: "F6", room: "zone_07", mode: "TRAINING", pose: { pos: [10.1234, 22, -3.5], target: [11, 21, -11] }, screen: "SCR-F6-DESK-SYSTEMS-01", src: "demo" };
  const url = contract.buildEnterUrl({ appPage: "screens/terminal.html", screenId: rp.screen, mode: rp.mode, returnPoint: rp, base: "/" });
  assert.match(url, /^\/screens\/terminal\.html\?screen=SCR-F6-DESK-SYSTEMS-01&mode=TRAINING&return=[A-Za-z0-9_-]+$/);
  const parsed = contract.parseEnterUrl(url.split("?")[1]);
  assert.equal(parsed.screenId, rp.screen);
  assert.equal(parsed.mode, "TRAINING");
  assert.deepEqual(parsed.returnPoint, { v: 1, href: rp.href, floor: "F6", room: "zone_07", mode: "TRAINING", pose: { pos: [10.123, 22, -3.5], target: [11, 21, -11] }, screen: rp.screen, src: "demo" });
  const back = contract.buildReturnUrl(parsed.returnPoint);
  assert.match(back, /^\/screens\/building\.html#eu-return=/);
  assert.deepEqual(contract.parseReturnHash(back.split("#")[1]), parsed.returnPoint);
  assert.equal(contract.normalizeMode("prim3 mission"), "MISSION");
});

test("return points refuse anything off-site or malformed", () => {
  for (const href of ["//evil.example/x", "https://evil.example/", "javascript:alert(1)", "/\\evil.example", "screens/building.html", "/a\nb", "/x:y"]) {
    assert.equal(contract.validateReturnPoint({ href, floor: "F1" }), null, href);
  }
  assert.equal(contract.decodeReturn("not*base64"), null);
  assert.equal(contract.decodeReturn(Buffer.from('{"href":"//evil"}').toString("base64url")), null);
  const ok = contract.validateReturnPoint({ href: "/screens/building.html", floor: "F9", mode: "ROOT", pose: { pos: [1, 2], target: [0, 0, 0] } });
  assert.equal(ok.floor, null); assert.equal(ok.mode, "WORKPLACE"); assert.equal(ok.pose, null);
  assert.throws(() => contract.buildEnterUrl({ appPage: "https://evil/x.html", screenId: "SCR-X" }));
});

test("approach pose sits in front of the screen in three.js world metres", () => {
  const s = screen("SCR-F2-DISPLAY-PERSPECTIVES");
  const p = contract.approachPose(s);
  assert.ok(Math.abs(p.target[0] - s.position.x * contract.FT) < 1e-3);
  assert.ok(Math.abs(p.target[2] + s.position.y * contract.FT) < 1e-3);
  assert.ok(p.pos[2] > p.target[2], "south-facing wall: the eye stands south (+z in world)");
});

/* ---------------------------------------------------------------- shell */
test("shell parsing, completion and contexts", () => {
  const ss = session("WORKPLACE");
  const sh = createShell({ ss, screen: screen("SCR-F2-USER-MON-01-01"), clock: CLOCK });
  assert.equal(sh.prompt(), "staff@f2-ws01:~$");
  assert.match(sh.exec("show vlan").lines.map((l) => l.t).join("\n"), /command not found/);
  assert.match(sh.exec("frobnicate").lines[0].t, /command not found/);
  assert.equal(sh.complete("pi").line, "ping ");
  assert.match(sh.complete("ssh f2-id").line, /^ssh f2-idf-sw01 $/);
  sh.exec("ssh f2-idf-sw01");
  assert.equal(sh.prompt(), "f2-idf-sw01#");
  assert.match(sh.complete("show int").line, /^show interfaces?\s?$/);
  sh.exec("configure terminal"); assert.equal(sh.prompt(), "f2-idf-sw01(config)#");
  sh.exec("interface gi1/0/8"); assert.equal(sh.prompt(), "f2-idf-sw01(config-if)#");
  assert.match(sh.exec("shutdown").lines[0].t, /read-only/, "WORKPLACE refuses changes");
  sh.exec("end"); sh.exec("exit"); assert.equal(sh.prompt(), "staff@f2-ws01:~$");
  assert.match(sh.exec("man ping").lines.map((l) => l.t).join("\n"), /ICMP/);
  assert.ok(sh.exec("clear").clear);
  assert.ok(sh.exec("exit").exit, "exit at the root console means back to the building");
});

test("the same commands give the same sandbox state and output (deterministic)", () => {
  const script = ["ssh f3-idf-sw01", "configure terminal", "interface gi1/0/10", "power inline never", "end", "show interfaces status", "show power inline", "exit", "camera list", "ping f3-cam01"];
  const a = drive(session("TRAINING"), "SCR-B1-TELECOM-CONSOLE-01", script);
  const b = drive(session("TRAINING"), "SCR-B1-TELECOM-CONSOLE-01", script);
  assert.equal(a, b);
  assert.match(a, /fault applied: PoE disabled/);
  assert.match(a, /f3-cam01\s+F3\s+\S+\s+NO-SIGNAL/);
});

const TICKET_FIXES = {
  B1: ["SCR-B1-ICT-RACK-UPS-01", ["ups status", "ups selftest", "ups replace-battery"]],
  F1: ["SCR-F1-IT-RACK-01", ["show interfaces status", "configure terminal", "interface gi1/0/3", "no shutdown", "end"]],
  F2: ["SCR-F2-AVIT-RACK-01", ["show interfaces status", "cable test Gi1/0/1", "cable reseat Gi1/0/1"]],
  F3: ["SCR-F3-NETWORK-IT-RACK-01", ["show interface gi1/0/7", "configure terminal", "interface gi1/0/7", "switchport voice vlan 50", "end"]],
  F4: ["SCR-F4-MEDIA-IT-RACK-01", ["show mls qos", "configure terminal", "mls qos", "end"]],
  F5: ["SCR-F5-RESEARCH-SYSTEMS-01", ["show vlan brief", "configure terminal", "interface gi1/0/3", "switchport access vlan 20", "end"]],
  F6: ["SCR-F6-DESK-SYSTEMS-01", ["show logging", "cable test Gi1/0/13", "cable reseat Gi1/0/13"]],
};
for (const [floor, [screenId, cmds]] of Object.entries(TICKET_FIXES)) {
  test(`TRAINING ${floor}: the floor's ticket is fixed from a console`, () => {
    const ss = session("TRAINING");
    const tk = ss.seedTraining(floor);
    assert.equal(tk.status, "open");
    assert.ok(ss.entries().length > 0);
    const out = drive(ss, screenId, ["ticket", ...cmds]);
    assert.match(out, /\[sandbox\] restored/, out);
    assert.equal(ss.ticket(floor).status, "resolved", out);
    assert.equal(ss.entries().length, 0);
    assert.equal(ss.session.evidence.length, 1);
    assert.equal(ss.session.evidence[0].execution_target, "SANDBOX");
  });
}

test("TRAINING L7: the roof controller comes back from the BAS lab console", () => {
  const ss = session("TRAINING");
  ss.seedTraining("L7");
  const out = drive(ss, "SCR-B1-LAB-CONSOLE-01", ["bacnet who-is", "bacnet read l7-bas01", "bacnet reinit l7-bas01", "bacnet who-is"]);
  assert.match(out, /APDU timeout/);
  assert.equal(ss.ticket("L7").status, "resolved");
});

test("services: stop, diagnose and restart DNS on its host", () => {
  const ss = session("TRAINING");
  const out = drive(ss, "SCR-B1-TELECOM-CONSOLE-01", ["ssh b1-hyp01", "systemctl stop named", "nslookup f2-cam01", "ping 10.70.2.11", "systemctl status named", "systemctl restart named", "nslookup f2-cam01"]);
  assert.match(out, /no servers could be reached/);
  assert.match(out, /Active: failed/);
  assert.match(out, /Name:\tf2-cam01\.eu\.sandbox/);
  assert.equal(ss.entries().length, 0);
});

/* ---------------------------------------------------------------- modes */
test("mode isolation: mission outages never reach WORKPLACE; reset clears one mode", () => {
  state.resetAllSessions();
  const preset = registry.mission_presets.F2;
  state.setMissionFaults(preset.faults, { presetId: preset.preset_id });
  const mission = new ScreenSandbox({ sandbox, screens: registry, mode: "MISSION" });
  const mnet = createNet(mission);
  assert.ok(mnet.cameras().filter((c) => mnet.levelOf(c) === "F2").every((c) => mnet.cameraFeed(c).state === "no-signal"));
  const work = new ScreenSandbox({ sandbox, screens: registry, mode: "WORKPLACE" });
  const wnet = createNet(work);
  assert.equal(work.entries().length, 0);
  assert.ok(wnet.cameras().every((c) => wnet.cameraFeed(c).state === "live"), "WORKPLACE shows normal operations");
  assert.throws(() => work.inject("poe_disabled", ["F2-SEC-CAM-01"]), /WORKPLACE/);
  state.saveSession("WORKPLACE", { faults: [{ fault_id: "host_down", target_selectors: ["B1-SRV-HYP-01-I001"] }] });
  assert.equal(state.loadSession("WORKPLACE").faults.length, 0, "WORKPLACE can never persist a fault");
  const training = new ScreenSandbox({ sandbox, screens: registry, mode: "TRAINING" });
  training.seedTraining("F6");
  assert.equal(state.loadSession("MISSION").faults.length, preset.faults.length, "TRAINING does not touch MISSION");
  state.resetSession("MISSION");
  assert.equal(state.loadSession("MISSION").faults.length, 0);
  assert.ok(state.loadSession("TRAINING").faults.length > 0, "resetting MISSION leaves TRAINING alone");
  training.reset();
  assert.equal(training.entries().length, 0);
  assert.equal(training.ticket("F6").status, "cleared");
  state.resetAllSessions();
});

test("app pages are owner-gated, noindex and phone-first", () => {
  for (const page of ["terminal", "kiosk", "noc", "vms", "studio", "evidence", "departures", "wall", "building"]) {
    const html = readFileSync(ROOT + `screens/${page}.html`, "utf8");
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, page);
    assert.match(html, /data-owner-gate/, page);
    assert.match(html, /width=device-width, initial-scale=1/, page);
    assert.doesNotMatch(html, /user-scalable|maximum-scale/, page);
  }
  const css = readFileSync(ROOT + "screens/screens.css", "utf8");
  assert.doesNotMatch(css, /max-width\s*:\s*\d+px\s*\)/, "min-width queries only");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/minmax\(0, 1fr\)/g, ""), /\b1fr\b/, "minmax(0,1fr), never a bare 1fr");
  assert.match(css, /font-size: max\(16px/);
  assert.doesNotMatch(css, /#(?:8b5cf6|7c3aed|a855f7|9333ea|6d28d9)|purple|violet/i, "no purple");
});
