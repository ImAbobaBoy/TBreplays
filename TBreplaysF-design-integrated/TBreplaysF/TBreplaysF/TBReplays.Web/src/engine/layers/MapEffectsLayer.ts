import * as THREE from 'three';

import type { TBReplaysApi } from '../../api/TBReplaysApi';
import type { MapCalibration } from '../../domain/MapCalibration';
import type { MapEffectDto } from '../../domain/MapModels';
import { mapReplayPositionToThree } from '../MapCalibrationTransforms';

export class MapEffectsLayer {
  private readonly root: THREE.Group;
  private readonly api: TBReplaysApi;

  public constructor(
    root: THREE.Group,
    api: TBReplaysApi,
  ) {
    this.root = root;
    this.api = api;
  }

  public async load(
    mapId: string,
    calibration: MapCalibration | null,
  ): Promise<void> {
    this.clear();

    const effectSet = await this.api.getMapEffects(mapId);

    for (const effect of effectSet.effects) {
      const object = this.createEffectObject(effect, calibration);

      if (object) {
        this.root.add(object);
      }
    }
  }

  public clear(): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      this.disposeObject(child);
    }
  }

  public dispose(): void {
    this.clear();
  }

  private createEffectObject(
    effect: MapEffectDto,
    calibration: MapCalibration | null,
  ): THREE.Object3D | null {
    if (effect.kind === 'decal') {
      return this.createDecalProxy(effect, calibration);
    }

    return this.createParticleProxy(effect, calibration);
  }

  private createParticleProxy(
    effect: MapEffectDto,
    calibration: MapCalibration | null,
  ): THREE.Object3D {
    const texture = this.createEffectTexture(effect.kind);

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: this.getEffectOpacity(effect.kind),
    });

    const sprite = new THREE.Sprite(material);
    const position = mapReplayPositionToThree(
      effect.position.x,
      effect.position.y,
      effect.position.z,
      calibration,
    );

    sprite.position.copy(position);
    sprite.position.y += effect.height * 0.45;

    sprite.scale.set(
      effect.radius * 2.0,
      effect.height,
      1,
    );

    sprite.name = `map_effect_${effect.id}_${effect.kind}`;

    return sprite;
  }

  private createDecalProxy(
    effect: MapEffectDto,
    calibration: MapCalibration | null,
  ): THREE.Object3D {
    const geometry = new THREE.CircleGeometry(effect.radius, 32);

    const material = new THREE.MeshBasicMaterial({
      color: 0x111827,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const decal = new THREE.Mesh(geometry, material);
    const position = mapReplayPositionToThree(
      effect.position.x,
      effect.position.y,
      effect.position.z,
      calibration,
    );

    decal.position.copy(position);
    decal.position.y += 0.05;

    decal.rotation.x = -Math.PI / 2;
    decal.name = `map_decal_${effect.id}`;

    return decal;
  }

  private createEffectTexture(kind: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Не удалось создать canvas context для effect texture.');
    }

    const gradient = context.createRadialGradient(
      128,
      128,
      8,
      128,
      128,
      128,
    );

    if (kind === 'fire') {
      gradient.addColorStop(0.0, 'rgba(255, 245, 180, 0.95)');
      gradient.addColorStop(0.25, 'rgba(255, 120, 20, 0.85)');
      gradient.addColorStop(0.65, 'rgba(180, 25, 10, 0.42)');
      gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    } else if (kind === 'smoke') {
      gradient.addColorStop(0.0, 'rgba(190, 190, 190, 0.48)');
      gradient.addColorStop(0.55, 'rgba(95, 95, 95, 0.34)');
      gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    } else if (kind === 'spark') {
      gradient.addColorStop(0.0, 'rgba(255, 245, 180, 1.0)');
      gradient.addColorStop(0.22, 'rgba(255, 180, 40, 0.8)');
      gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    } else if (kind === 'glow') {
      gradient.addColorStop(0.0, 'rgba(180, 220, 255, 0.75)');
      gradient.addColorStop(0.5, 'rgba(70, 130, 255, 0.35)');
      gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    } else {
      gradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.45)');
      gradient.addColorStop(0.7, 'rgba(160, 180, 200, 0.28)');
      gradient.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    }

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    return texture;
  }

  private getEffectOpacity(kind: string): number {
    if (kind === 'smoke') {
      return 0.58;
    }

    if (kind === 'fire') {
      return 0.85;
    }

    if (kind === 'spark') {
      return 0.92;
    }

    if (kind === 'glow') {
      return 0.62;
    }

    return 0.55;
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of object.children) {
      this.disposeObject(child);
    }

    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();

      if (Array.isArray(object.material)) {
        for (const material of object.material) {
          material.dispose();
        }
      } else {
        object.material.dispose();
      }
    }

    if (object instanceof THREE.Sprite) {
      const material = object.material;

      if (material.map) {
        material.map.dispose();
      }

      material.dispose();
    }
  }
}