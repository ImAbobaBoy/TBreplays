type Point = { x: number; y: number; z: number };

/** Replay fire packets may contain projectile velocity rather than a unit direction. */
export function shotRayEnd(origin: Point, direction: Point, length: number): Point | null {
  if (![origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, length].every(Number.isFinite)) return null;
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (magnitude < 1e-8 || length <= 0) return null;
  return { x: origin.x + direction.x / magnitude * length,
    y: origin.y + direction.y / magnitude * length, z: origin.z + direction.z / magnitude * length };
}
