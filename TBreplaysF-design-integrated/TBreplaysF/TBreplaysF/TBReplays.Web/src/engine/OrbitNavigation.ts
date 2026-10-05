export function orbitWheelDistance(distance: number, delta: number, mode: number, step: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 800 : 1);
  return Math.max(2, distance + Math.max(-4, Math.min(4, pixels / 100)) * step);
}
export function orbitPanSpeed(distance: number, reference: number): number {
  return reference / Math.max(2, distance);
}
