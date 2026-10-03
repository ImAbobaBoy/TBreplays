import * as THREE from 'three';
import { MapDdsLoader } from '../MapDdsLoader';
import { bakeLandscape } from '../LandscapeSurface';

import type { TBReplaysApi } from '../../api/TBReplaysApi';
import type { MapCalibration } from '../../domain/MapCalibration';

export class SurfaceTextureLayer {
  private generation = 0;
  private readonly api: TBReplaysApi;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ddsLoader = new MapDdsLoader().setWithCredentials(true);

  private currentTexture: THREE.Texture | null = null;
  private bakedTarget: THREE.WebGLRenderTarget | null = null;

  public constructor(
    api: TBReplaysApi,
    renderer: THREE.WebGLRenderer,
  ) {
    this.api = api;
    this.renderer = renderer;
  }

  public async load(
    mapId: string,
    calibration: MapCalibration | null,
  ): Promise<THREE.Texture | null> {
    this.clear();

    const generation = this.generation;
    const surface = await this.api.getMapSurface(mapId);
    const textures: Record<string, THREE.Texture> = {};
    const roles = ['colorTexture', 'tileTexture0', 'tileMask', 'tileMaskHeightBlend', 'tileHeightTexture'];
    try {
      // Load only the legacy shader's inputs, not all exported PBR/effect assets.
      const results = await Promise.allSettled(roles.map(async role => {
        const entry = surface.textures.find(t => t.role === role && t.url);
        if (!entry?.url) return;
        const input = await this.ddsLoader.loadAsync(this.api.createUrl(entry.url));
        input.colorSpace = THREE.NoColorSpace;
        input.wrapS = input.wrapT = role === 'tileTexture0' || role === 'tileHeightTexture'
          ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        textures[role] = input;
      }));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (generation !== this.generation) return null;
      if (!textures.colorTexture || !textures.tileTexture0 || !textures.tileMask)
        throw new Error('Landscape material не содержит обязательных слоёв');
      this.bakedTarget = bakeLandscape(this.renderer, surface, textures);
    } finally {
      for (const input of Object.values(textures)) input.dispose();
    }
    const texture = this.bakedTarget.texture;

    if (generation !== this.generation) { texture.dispose(); return null; }
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    if (calibration) {
      texture.center.set(0.5, 0.5);
      texture.rotation = THREE.MathUtils.degToRad(calibration.texture.rotationDegrees);

      if (calibration.texture.flipU) {
        texture.repeat.x = -Math.abs(texture.repeat.x || 1);
      }

      if (calibration.texture.flipV) {
        texture.repeat.y = -Math.abs(texture.repeat.y || 1);
      }
    }

    this.currentTexture = texture;

    return texture;
  }

  public clear(): void {
    this.generation++;
    this.bakedTarget?.dispose();
    this.bakedTarget = null;
    if (this.currentTexture) {
      this.currentTexture.dispose();
      this.currentTexture = null;
    }
  }

  public dispose(): void {
    this.clear();
  }
}
