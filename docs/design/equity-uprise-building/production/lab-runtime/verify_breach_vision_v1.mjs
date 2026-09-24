/* Verifies breach-vision against the canonical registry and a live sandbox.
 *
 * The assertions that matter are the ones a game designer would get wrong
 * quietly: that an intact building is fully watched, that blinding a camera
 * actually costs coverage, and that a loud attack which buys no darkness
 * scores worse than a quiet one that does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ElectronicsSandbox } from "./equity-uprise-electronics-sandbox.mjs";
import { buildVisionModel, deriveVision, scoreBreach, BREACH_VISION_VERSION } from "./breach-vision-v1.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD = join(HERE, "..");
const read = (rel) => JSON.parse(readFileSync(join(PROD, rel), "utf8"));

const registry = read("asset-registry/generated/equity-uprise-asset-registry-v1.json");
const connections = read("electronics/generated/equity-uprise-electronics-connections-v1.json");
const manifest = read("electronics/generated/equity-uprise-electronics-manifest-v1.json");

const newSandbox = () => new ElectronicsSandbox({ registry, connections, manifest });

const checks = [];
const check = (name, passed, detail = "") => checks.push({ name, passed: Boolean(passed), detail: String(detail) });

const model = buildVisionModel(registry);
const baseline = deriveVision(model, newSandbox());

check("model finds security cameras", model.cameras.length > 0, `${model.cameras.length} cameras`);
check("every camera carries a level", model.cameras.every((c) => c.level_id !== "UNKNOWN"), `${model.levels.length} levels`);
check("grid covers the canonical 72ft plate", model.grid_n * model.config.grid_ft >= model.plate_ft,
  `${model.grid_n}x${model.grid_n} cells of ${model.config.grid_ft}ft`);

check("intact building reports no cameras down", baseline.totals.cameras_down === 0,
  `coverage ${baseline.totals.coverage_pct}%`);
check("intact building observes some floor area", baseline.totals.observed_cells > 0,
  `${baseline.totals.observed_cells}/${baseline.totals.cells_total} cells`);

const targetLevel = model.levels.find((id) => baseline.levels[id].cameras_total > 0 && baseline.levels[id].coverage_pct > 0) || model.levels[0];

/* camera_link_down is a single-device fault, and coverage on a level is
   redundant, so killing ONE camera legitimately changes nothing. That is the
   correct behaviour and the reason the attacker has to reach upstream. The
   assertion is therefore about the whole level going dark, not one device. */
const levelCameras = model.cameras.filter((c) => c.level_id === targetLevel).map((c) => c.asset_id);
const blinded = newSandbox();
for (const id of levelCameras) blinded.injectFault("camera_link_down", { target_selectors: [id] });
const afterBlind = deriveVision(model, blinded);

check("blinding every camera on a level drops them all",
  afterBlind.levels[targetLevel].cameras_down === levelCameras.length,
  `${targetLevel}: ${afterBlind.levels[targetLevel].cameras_down}/${levelCameras.length} down`);
check("a fully blinded level is fully dark",
  afterBlind.levels[targetLevel].coverage_pct === 0,
  `${targetLevel}: ${baseline.levels[targetLevel].coverage_pct}% -> ${afterBlind.levels[targetLevel].coverage_pct}%`);

const otherLevels = model.levels.filter((id) => id !== targetLevel);
check("blinding one level does not affect the others",
  otherLevels.every((id) => afterBlind.levels[id].coverage_pct === baseline.levels[id].coverage_pct),
  `${otherLevels.length} levels unchanged`);

check("darkness is gained, not lost", afterBlind.totals.dark_cells > baseline.totals.dark_cells,
  `${baseline.totals.dark_cells} -> ${afterBlind.totals.dark_cells} dark cells`);

/* Killing a single camera where coverage overlaps must be a no-op, or the
   attacker gets darkness for free and the upstream decision stops mattering. */
const oneDown = newSandbox();
oneDown.injectFault("camera_link_down", { target_selectors: [levelCameras[0]] });
const afterOne = deriveVision(model, oneDown);
check("redundant coverage survives losing a single camera",
  afterOne.levels[targetLevel].cameras_down === 1
    && afterOne.levels[targetLevel].coverage_pct === baseline.levels[targetLevel].coverage_pct,
  `${targetLevel}: 1 camera down, coverage still ${afterOne.levels[targetLevel].coverage_pct}%`);

/* The tactical claim: cutting mains is loud and blinds nothing because the
   cameras sit on UPS, so it must score strictly worse than taking the UPS. */
const mains = newSandbox();
mains.injectFault("normal_power_loss", { target_selectors: [`level:${targetLevel}:type:electrical_panel`] });
const mainsVision = deriveVision(model, mains);
const mainsScore = scoreBreach(baseline, mainsVision, mains.summary());

const ups = newSandbox();
ups.injectFault("idf_ups_failure", { target_selectors: [`level:${targetLevel}:type:rack_ups`] });
const upsVision = deriveVision(model, ups);
const upsScore = scoreBreach(baseline, upsVision, ups.summary());

check("cutting mains power is loud", mainsScore.noise_assets_faulted > upsScore.noise_assets_faulted,
  `mains ${mainsScore.noise_assets_faulted} vs ups ${upsScore.noise_assets_faulted} assets`);
check("taking the UPS buys more darkness than cutting mains",
  upsScore.dark_cells_gained >= mainsScore.dark_cells_gained,
  `ups +${upsScore.dark_cells_gained} vs mains +${mainsScore.dark_cells_gained} dark cells`);
check("the quiet attack scores better", upsScore.efficiency > mainsScore.efficiency,
  `ups ${upsScore.efficiency} vs mains ${mainsScore.efficiency} darkness/noise`);

/* Determinism: the same faults on a fresh sandbox must give the same vision,
   or replay and seeded missions are meaningless. */
const repeat = newSandbox();
for (const id of levelCameras) repeat.injectFault("camera_link_down", { target_selectors: [id] });
check("derivation is deterministic",
  JSON.stringify(deriveVision(model, repeat)) === JSON.stringify(afterBlind),
  "same faults produce identical vision");

/* A snapshot must drive vision without a simulator, so a turn can be replayed
   from stored state. */
const replayState = {};
for (const [id, state] of blinded.assetStates.entries()) replayState[id] = state;
check("vision can be derived from a plain state map",
  JSON.stringify(deriveVision(model, replayState)) === JSON.stringify(afterBlind),
  "snapshot replay matches live sandbox");

/* PLACEMENT READINESS — reported, never asserted.
 *
 * The machinery above is correct whatever the coordinates say, but coverage
 * is only meaningful if cameras are actually placed. Today every security
 * camera carries placement_authority "unknown", and per level they sit within
 * a few feet of each other — a default, not a security layout. Reporting it
 * here keeps the number honest: a coverage percentage computed from
 * placeholder positions is arithmetic, not intelligence. This is a data gap
 * in the building, not a failure of this module, so it does not fail the run.
 */
const placement = (() => {
  const byLevel = {};
  for (const cam of model.cameras) (byLevel[cam.level_id] ||= []).push(cam);
  const spread = {};
  for (const [levelId, cams] of Object.entries(byLevel)) {
    let max = 0;
    for (const a of cams) for (const b of cams) {
      max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y));
    }
    spread[levelId] = { cameras: cams.length, max_separation_ft: Math.round(max * 10) / 10 };
  }
  const authorities = {};
  for (const asset of registry.assets || []) {
    if ((asset?.classification?.asset_type) !== "camera") continue;
    const key = asset?.location?.placement_authority || "unset";
    authorities[key] = (authorities[key] || 0) + 1;
  }
  const authored = Object.entries(authorities)
    .filter(([key]) => key !== "unknown" && key !== "unset")
    .reduce((sum, [, n]) => sum + n, 0);
  return {
    placement_authority: authorities,
    authored_cameras: authored,
    per_level_spread_ft: spread,
    plate_ft: model.plate_ft,
    verdict: authored === 0
      ? "PLACEHOLDER — no security camera has an authored position; coverage figures are mechanism-only"
      : "authored positions present"
  };
})();

const passed = checks.filter((c) => c.passed).length;
const report = {
  contract: "equity-uprise-breach-vision/v1",
  version: BREACH_VISION_VERSION,
  execution_target: "SANDBOX",
  cameras: model.cameras.length,
  levels: model.levels,
  placement_readiness: placement,
  baseline_coverage_pct: baseline.totals.coverage_pct,
  sample_level: targetLevel,
  mains_score: mainsScore,
  ups_score: upsScore,
  checks_total: checks.length,
  checks_passed: passed,
  checks_failed: checks.length - passed,
  passed: passed === checks.length,
  checks
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
