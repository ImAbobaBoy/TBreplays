import type { MapCalibration } from '../domain/MapCalibration';
import type {
  MapEffectSet,
  MapManifest,
  MapObjectMeshManifest,
  TerrainTextureManifest,
} from '../domain/MapModels';

export class TBReplaysApi {
  private readonly apiBase: string;

  public constructor(apiBase: string) {
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  public async getMapManifest(mapId: string): Promise<MapManifest> {
    return await this.getJson<MapManifest>(`/api/maps/${mapId}/manifest`);
  }

  public async getMapCalibration(mapId: string): Promise<MapCalibration> {
    return await this.getJson<MapCalibration>(`/api/maps/${mapId}/calibration`);
  }

  public async saveMapCalibration(
    mapId: string,
    calibration: MapCalibration,
  ): Promise<MapCalibration> {
    return await this.sendJson<MapCalibration>(
      `/api/maps/${mapId}/calibration`,
      'PUT',
      calibration,
    );
  }

  public async getTerrainChunk(url: string): Promise<ArrayBuffer> {
    return await this.getArrayBuffer(url);
  }

  public async getTerrainTextureManifest(mapId: string): Promise<TerrainTextureManifest> {
    return await this.getJson<TerrainTextureManifest>(`/api/maps/${mapId}/terrain/texture/manifest`);
  }

  public async getObjectMeshManifest(mapId: string): Promise<MapObjectMeshManifest> {
    return await this.getJson<MapObjectMeshManifest>(`/api/maps/${mapId}/object-mesh/manifest`);
  }

  public async getObjectMesh(url: string): Promise<ArrayBuffer> {
    return await this.getArrayBuffer(url);
  }

  public async getMapEffects(mapId: string): Promise<MapEffectSet> {
    return await this.getJson<MapEffectSet>(`/api/maps/${mapId}/effects`);
  }

  public createUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    return `${this.apiBase}${url}`;
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetch(this.createUrl(url), {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.json() as T;
  }

  private async sendJson<T>(
    url: string,
    method: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(this.createUrl(url), {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.json() as T;
  }

  private async getArrayBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetch(this.createUrl(url), {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.arrayBuffer();
  }
}