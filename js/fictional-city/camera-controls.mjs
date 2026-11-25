// Camera-only state. It never changes player coordinates, saved progress or geography.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function createCameraControls() {
  const view = {
    mode: 'close', follow: false, yaw: 0, pitch: .22, zoom: 1,
    setMode(mode, context = {}) {
      if (!['close', 'first', 'overview'].includes(mode)) return false;
      this.mode = mode; this.reset(context); return true;
    },
    reset({ playerYaw = Math.PI, island = false } = {}) {
      this.yaw = this.mode !== 'overview' ? playerYaw + Math.PI : island ? Math.PI + .35 : .68;
      this.pitch = this.mode === 'first' ? 0 : this.mode !== 'overview' ? .22 : Math.atan2(31, 39);
      this.zoom = this.mode === 'overview' && island ? .7 : 1;
    },
    look(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      this.yaw -= dx * .006;
      this.pitch = clamp(this.pitch + dy * .004, this.mode !== 'overview' ? -.16 : .25, this.mode !== 'overview' ? .75 : 1.2);
    },
    zoomBy(factor) {
      if (Number.isFinite(factor) && factor > 0) this.zoom = clamp(this.zoom * factor, .7, this.mode !== 'overview' ? 5 : 3);
    }
  };
  return view;
}

// Follow the full camera boom, not only its endpoint: never jump through a thin wall.
// Walking collision already knows indoor walls, fixtures and always-resident outdoor geometry.
export function safeCameraDistance(player, yaw, requested, isClear) {
  const distance = clamp(Number.isFinite(requested) ? requested : 1, .08, 8);
  const steps = Math.ceil(distance / .12);
  let safe = 0;
  for (let i = 1; i <= steps; i++) {
    const at = distance * i / steps;
    if (!isClear(player.x + Math.sin(yaw) * at, player.z + Math.cos(yaw) * at)) break;
    safe = at;
  }
  return Math.max(.02, safe);
}

export function viewHeading(yaw) {
  const degrees = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
  return { degrees, label: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8] };
}
