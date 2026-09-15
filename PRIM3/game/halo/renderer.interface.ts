export type HaloLngLat = { longitude: number; latitude: number; altitude?: number };

export type HaloMissionMarker = {
  id: string;
  position: HaloLngLat;
  label: string;
  status: 'locked' | 'available' | 'active' | 'complete';
  metadata?: Record<string, unknown>;
};

export type HaloLayerId = 'missions' | 'regions' | 'routes' | 'facilities' | 'intel' | string;

export interface HaloRenderer {
  setWorldView(view: { center?: HaloLngLat; range?: number; pitch?: number; heading?: number }): Promise<void> | void;
  flyToRegion(target: HaloLngLat, options?: { durationMs?: number; range?: number }): Promise<void>;
  addMissionMarker(marker: HaloMissionMarker): void;
  updateMissionMarker(id: string, patch: Partial<HaloMissionMarker>): void;
  removeMissionMarker(id: string): void;
  setLayerVisibility(layer: HaloLayerId, visible: boolean): void;
  renderDeploymentArc(id: string, from: HaloLngLat, to: HaloLngLat): void;
  focusMission(id: string): Promise<void>;
  setSelection(id: string | null): void;
  destroy(): void;
}
