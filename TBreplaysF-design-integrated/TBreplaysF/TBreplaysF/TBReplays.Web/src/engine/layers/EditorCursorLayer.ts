import * as THREE from 'three';
import { createTextSign } from '../TextSign';
import type { ScenePresenceFrame } from '../../domain/ScenePresenceModels';

export class EditorCursorLayer {
  public readonly root = new THREE.Group();
  private entries = new Map<string, { root: THREE.Group; label: THREE.Sprite; mesh: THREE.Mesh; key: string }>();
  constructor() { this.root.name = 'editor_cursors'; }
  public sync(frames: ScenePresenceFrame[], now = Date.now()): void {
    const visible = frames.filter(frame => frame.cursor && now - frame.updatedAtUnixMs < 10000);
    const ids = new Set(visible.map(frame => frame.connectionId));
    for (const [id, entry] of this.entries) if (!ids.has(id)) {
      this.disposeEntry(entry); this.entries.delete(id);
    }
    for (const frame of visible) {
      const key = frame.login + frame.color;
      let entry = this.entries.get(frame.connectionId);
      if (entry?.key !== key) {
        if (entry) this.disposeEntry(entry);
        const group = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(2.5, 7, 8), new THREE.MeshBasicMaterial({ color: frame.color, depthTest: false, transparent: true, opacity: .95 }));
        mesh.rotation.z = Math.PI; mesh.position.y = 6; mesh.renderOrder = 1500;
        const label = createTextSign(frame.login, frame.color, 5);
        label.position.y = 12; label.renderOrder = 1501;
        group.add(mesh, label); this.root.add(group);
        entry = { root: group, label, mesh, key }; this.entries.set(frame.connectionId, entry);
      }
      entry.root.position.set(frame.cursor!.x, frame.cursor!.y + 2, frame.cursor!.z);
    }
  }
  public updateView(camera: THREE.PerspectiveCamera, height: number): void {
    for (const entry of this.entries.values()) {
      const worldPerPixel = 2 * entry.root.position.distanceTo(camera.position) * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, height);
      entry.root.scale.setScalar(THREE.MathUtils.clamp(worldPerPixel * 1.1, .5, 12));
    }
  }
  private disposeEntry(entry: { root: THREE.Group; label: THREE.Sprite; mesh: THREE.Mesh }): void {
    this.root.remove(entry.root); entry.mesh.geometry.dispose(); (entry.mesh.material as THREE.Material).dispose();
    entry.label.material.map?.dispose(); entry.label.material.dispose();
  }
  public dispose(): void { for (const entry of this.entries.values()) this.disposeEntry(entry); this.entries.clear(); }
}
