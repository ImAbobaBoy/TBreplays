import * as THREE from 'three';
import type { MapObjectMeshManifest } from '../domain/MapModels';

// Match the separate advertising face, never the frame or vegetation billboards.
export function remapBillboardFaces(geometry: THREE.BufferGeometry,
  instances: MapObjectMeshManifest['instances'], materialIndex: number): number {
  const faces = (instances ?? []).filter(i => i.name === 'billboard_type1_texture'
    && i.startIndex >= 0 && i.indexCount > 0).sort((a,b) => a.startIndex-b.startIndex);
  if (!faces.length) return 0;
  const groups = geometry.groups.slice();
  geometry.clearGroups();
  let replaced = 0;
  for (const group of groups) {
    let start = group.start;
    const end = group.start + group.count;
    for (const face of faces) {
      const from = Math.max(start, face.startIndex), to = Math.min(end, face.startIndex + face.indexCount);
      if (from >= to) continue;
      if (from > start) geometry.addGroup(start, from-start, group.materialIndex);
      geometry.addGroup(from, to-from, materialIndex);
      replaced += to-from; start = to;
    }
    if (start < end) geometry.addGroup(start, end-start, group.materialIndex);
  }
  return replaced;
}
