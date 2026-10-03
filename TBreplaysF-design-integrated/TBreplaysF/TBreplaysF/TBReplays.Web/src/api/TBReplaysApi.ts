import { authorizedFetch } from './OnlineHttp';
import type { MapCalibration } from '../domain/MapCalibration';
import type {
  ReplayImportBatchResult,
  ReplayImportItemResult,
  ReplayParseResult,
  ReplayPresentation,
  ReplaySessionItem,
} from '../domain/ReplayModels';
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

  public async getMapSurface(mapId: string): Promise<import('../domain/MapModels').MapSurfaceManifest> {
    return await this.getJson(`/api/maps/${mapId}/surface`);
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

  public async importLocalReplay(replayFileName?: string): Promise<ReplayImportItemResult> {
    const query = replayFileName ? `?replayFileName=${encodeURIComponent(replayFileName)}` : '';

    return await this.sendWithoutBody<ReplayImportItemResult>(
      `/api/replays/import-local${query}`,
      'POST',
    );
  }

  public async importReplayFiles(files: File[]): Promise<ReplayImportBatchResult> {
    const formData = new FormData();

    files.forEach((file) => {
      formData.append('files', file);
    });

    return await this.sendFormData<ReplayImportBatchResult>(
      '/api/replays/import',
      'POST',
      formData,
    );
  }

  public async getCurrentSessionReplays(mapName?: string): Promise<ReplaySessionItem[]> {
    const query = mapName ? `?mapName=${encodeURIComponent(mapName)}` : '';

    return await this.getJson<ReplaySessionItem[]>(`/api/replays/session/current${query}`);
  }

  public async getReplayPresentation(replayId: string): Promise<ReplayPresentation> {
    const response = await authorizedFetch(`${this.apiBase}/api/replays/${encodeURIComponent(replayId)}/presentation`, { cache: 'no-store' });
    if (response.status === 409) throw new Error('Реплей сохранён в старом формате. Импортируйте файл повторно.');
    if (!response.ok) throw new Error(`Не удалось загрузить реплей (HTTP ${response.status}). Требуется backend v2.`);
    const data: ReplayPresentation = await response.json();
    if (data.schemaVersion !== 2 || data.playback?.timeBasis !== 'replaySeconds'
      || !Array.isArray(data.playback.vehicles) || !Array.isArray(data.playback.scoreboard)) {
      throw new Error('Неподдерживаемый формат presentation реплея. Обновите backend и повторите импорт.');
    }
    return data;
  }

  public async getReplayParseResult(replayId: string): Promise<ReplayParseResult> {
    return await this.getJson<ReplayParseResult>(`/api/replays/${replayId}/parse-result`);
  }

  public createUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    return `${this.apiBase}${url}`;
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await authorizedFetch(this.createUrl(url), {
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
    const response = await authorizedFetch(this.createUrl(url), {
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

  private async sendFormData<T>(
    url: string,
    method: string,
    body: FormData,
  ): Promise<T> {
    const response = await authorizedFetch(this.createUrl(url), {
      method,
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.json() as T;
  }

  private async sendWithoutBody<T>(
    url: string,
    method: string,
  ): Promise<T> {
    const response = await authorizedFetch(this.createUrl(url), {
      method,
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.json() as T;
  }

  private async getArrayBuffer(url: string): Promise<ArrayBuffer> {
    const response = await authorizedFetch(this.createUrl(url), {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.arrayBuffer();
  }
}
