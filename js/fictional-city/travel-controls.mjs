// Session locomotion only. Not an inventory, ownership, payment or shared-policy ledger.
// Metric collision profiles keep free walk independent of square/hex display topology.
export const TRAVEL = Object.freeze({
  walk: Object.freeze({ speed: 6.8, radius: .43 }),
  bike: Object.freeze({ speed: 11, radius: 1.08, acceleration: 5.5 })
});
export function createTravelControls() {
  let mode = 'walk', speed = 0;
  return {
    get mode() { return mode; }, get radius() { return TRAVEL[mode].radius; },
    setMode(next, { interior = false, clear = () => true } = {}) {
      if (!Object.hasOwn(TRAVEL, next) || (next === 'bike' && (interior || !clear(TRAVEL.bike.radius)))) return false;
      mode = next; speed = 0; return true;
    },
    speedFor(throttle, dt) {
      if (!Number.isFinite(throttle) || !Number.isFinite(dt) || dt < 0 || throttle === 0) { speed = 0; return 0; }
      const profile = TRAVEL[mode];
      speed = mode === 'walk' ? profile.speed : Math.min(profile.speed, speed + profile.acceleration * Math.min(dt, .05));
      return speed;
    },
    stop() { speed = 0; }
  };
}
