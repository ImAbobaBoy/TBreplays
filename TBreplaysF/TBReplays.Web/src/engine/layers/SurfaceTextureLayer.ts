import * as THREE from 'three';
import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js';

import type { TBReplaysApi } from '../../api/TBReplaysApi';
import type { MapCalibration } from '../../domain/MapCalibration';

export class SurfaceTextureLayer {
  private readonly api: TBReplaysApi;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ddsLoader = new DDSLoader();

  private currentTexture: THREE.Texture | null = null;

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

    const manifest = await this.api.getTerrainTextureManifest(mapId);

    if (!manifest.url || manifest.sizeBytes <= 0) {
      return null;
    }

    const texture = await this.ddsLoader.loadAsync(
      this.api.createUrl(manifest.url),
    );

    texture.colorSpace = THREE.SRGBColorSpace;
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
    if (this.currentTexture) {
      this.currentTexture.dispose();
      this.currentTexture = null;
    }
  }

  public dispose(): void {
    this.clear();
  }
}