/* BREACH VISION — what the building can still see.
 *
 * Derives observed/dark floor area from live electronics-sandbox state. It is
 * the first piece of the two-phase breach game: the cyber phase spends faults
 * to buy darkness, and the physical phase moves through whatever darkness it
 * bought. Fog of war is therefore not authored, it is COMPUTED from which
 * cameras the simulator currently reports up.
 *
 * READS GEOMETRY, NEVER WRITES IT. Camera positions come from the canonical
 * asset registry (location.center_ft, core-v2-local-ft). This module adds no
 * geometry, moves nothing, and emits no artifact the building depends on. The
 * building remains authority; this is a view over it.
 *
 * WHY A GRID AND NOT A FRUSTUM. The registry gives each camera a position but
 * no bearing, lens or field of view, so a cone would be invented precision —
 * it would look rigorous and mean nothing. A radius answers the only question
 * the game actually asks ("is this patch of floor observed by anything that is
 * still up?") using data that genuinely exists. When real bearings land in the
 * registry, swap coverageFor() and nothing above it changes.
 */

export const BREACH_VISION_VERSION = "1.0.0";

/* The canonical plate from building-core-v2.json. Asserted rather than
   imported so this module stays a pure function of what it is handed. */
const PLATE_FT = 72;

/* A camera that is up watches this far; one the simulator reports degraded
   watches less. Tunable per mission — GHOST wants a meaner building. */
export const DEFAULT_VISION = Object.freeze({
  coverage_radius_ft: 24,
  degraded_radius_ft: 12,
  grid_ft: 6
});

const SECURITY_CAMERA_TYPE = "camera";

function cellCentres(gridFt) {
  const n = Math.ceil(PLATE_FT / gridFt);
  const centres = [];
  for (let iy = 0; iy < n; iy += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      centres.push({ ix, iy, x: (ix + 0.5) * gridFt, y: (iy + 0.5) * gridFt });
    }
  }
  return { n, centres };
}

/* The registry is large and mostly not cameras. Extract once, reuse per turn:
   a breach loop re-derives vision after every fault, so this must not re-walk
   1,883 assets each time. */
export function buildVisionModel(registry, options = {}) {
  const cfg = { ...DEFAULT_VISION, ...options };
  const cameras = [];

  for (const asset of registry?.assets || []) {
    const type = asset?.classification?.asset_type || asset?.source_snapshot?.asset_type;
    if (type !== SECURITY_CAMERA_TYPE) continue;
    const centre = asset?.location?.center_ft;
    if (!Array.isArray(centre) || centre.length < 2) continue;
    const [x, y] = centre;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    cameras.push({
      asset_id: asset.asset_id,
      level_id: asset?.location?.level_id || "UNKNOWN",
      zone_id: asset?.location?.zone_id || null,
      x,
      y
    });
  }

  const levels = [...new Set(cameras.map((c) => c.level_id))].sort();
  const grid = cellCentres(cfg.grid_ft);

  return {
    version: BREACH_VISION_VERSION,
    config: cfg,
    plate_ft: PLATE_FT,
    grid_n: grid.n,
    cells_per_level: grid.centres.length,
    cell_centres: grid.centres,
    cameras,
    levels
  };
}

function coverageFor(availability, cfg) {
  if (availability === "available") return cfg.coverage_radius_ft;
  if (availability === "degraded") return cfg.degraded_radius_ft;
  return 0;
}

/* The sandbox exposes assetStates as a Map; accept either that or a plain
   object of the same shape so a caller can replay a snapshot without
   standing up a whole simulator. */
function readState(sandbox, assetId) {
  if (!sandbox) return null;
  if (typeof sandbox.get === "function") return sandbox.get(assetId) || null;
  if (sandbox.assetStates && typeof sandbox.assetStates.get === "function") {
    return sandbox.assetStates.get(assetId) || null;
  }
  if (sandbox.assetStates) return sandbox.assetStates[assetId] || null;
  return sandbox[assetId] || null;
}

export function deriveVision(model, sandbox) {
  const cfg = model.config;
  const levels = {};

  for (const levelId of model.levels) {
    levels[levelId] = {
      level_id: levelId,
      cameras_total: 0,
      cameras_up: 0,
      cameras_degraded: 0,
      cameras_down: 0,
      down_camera_ids: [],
      observed_cells: 0,
      dark_cells: 0,
      cells_total: model.cells_per_level,
      coverage_pct: 0,
      dark_cell_index: []
    };
  }

  const active = new Map();
  for (const cam of model.cameras) {
    const level = levels[cam.level_id];
    if (!level) continue;
    level.cameras_total += 1;

    const state = readState(sandbox, cam.asset_id);
    const availability = state?.availability ?? "available";
    const radius = coverageFor(availability, cfg);

    if (availability === "available") level.cameras_up += 1;
    else if (availability === "degraded") level.cameras_degraded += 1;
    else {
      level.cameras_down += 1;
      level.down_camera_ids.push(cam.asset_id);
    }

    if (radius > 0) {
      if (!active.has(cam.level_id)) active.set(cam.level_id, []);
      active.get(cam.level_id).push({ x: cam.x, y: cam.y, r2: radius * radius });
    }
  }

  for (const levelId of model.levels) {
    const level = levels[levelId];
    const watchers = active.get(levelId) || [];
    let observed = 0;

    for (const cell of model.cell_centres) {
      let seen = false;
      for (const w of watchers) {
        const dx = cell.x - w.x;
        const dy = cell.y - w.y;
        if (dx * dx + dy * dy <= w.r2) { seen = true; break; }
      }
      if (seen) observed += 1;
      else level.dark_cell_index.push(cell.iy * model.grid_n + cell.ix);
    }

    level.observed_cells = observed;
    level.dark_cells = level.cells_total - observed;
    level.coverage_pct = level.cells_total
      ? Math.round((observed / level.cells_total) * 1000) / 10
      : 0;
  }

  const order = model.levels;
  const totals = order.reduce((acc, id) => {
    const l = levels[id];
    acc.cameras_total += l.cameras_total;
    acc.cameras_down += l.cameras_down;
    acc.observed_cells += l.observed_cells;
    acc.cells_total += l.cells_total;
    return acc;
  }, { cameras_total: 0, cameras_down: 0, observed_cells: 0, cells_total: 0 });

  totals.coverage_pct = totals.cells_total
    ? Math.round((totals.observed_cells / totals.cells_total) * 1000) / 10
    : 0;
  totals.dark_cells = totals.cells_total - totals.observed_cells;

  return { version: BREACH_VISION_VERSION, levels, level_order: order, totals };
}

/* What a fault BOUGHT, which is the only number the attacker actually plays
   for. Noise is how much of the building noticed — a defender watching an
   alarm console sees asset count, not intent. Darkness is floor area that
   stopped being observed. The ratio is the whole tactical decision. */
export function scoreBreach(before, after, sandboxSummary) {
  const darkGained = after.totals.dark_cells - before.totals.dark_cells;
  const camerasLost = after.totals.cameras_down - before.totals.cameras_down;
  const noise = sandboxSummary?.faulted_asset_count ?? 0;

  return {
    dark_cells_gained: darkGained,
    cameras_lost: camerasLost,
    coverage_before_pct: before.totals.coverage_pct,
    coverage_after_pct: after.totals.coverage_pct,
    noise_assets_faulted: noise,
    /* Darkness per unit of noise. A mains cut is loud and buys nothing
       because the cameras sit on UPS; that tradeoff is real engineering
       surfacing as a tactical choice, and it is why this ratio is the score
       rather than raw damage. */
    efficiency: noise > 0 ? Math.round((darkGained / noise) * 1000) / 1000 : 0
  };
}
