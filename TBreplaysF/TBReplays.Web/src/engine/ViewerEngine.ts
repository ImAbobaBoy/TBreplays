import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { AppMode } from '../app/AppMode';
import type { ViewerTool } from '../app/AppState';
import { TBReplaysApi } from '../api/TBReplaysApi';
import type { MapCalibration } from '../domain/MapCalibration';
import type { MapManifest } from '../domain/MapModels';
import type {
  ReplayPlaybackState,
  ReplayTimelineSummary,
} from '../domain/ReplayModels';
import type { ManualTankModel } from '../domain/TankModels';
import { DrawingLayer } from './layers/DrawingLayer';
import { MapEffectsLayer } from './layers/MapEffectsLayer';
import { ObjectMeshLayer } from './layers/ObjectMeshLayer';
import { ReplayLayer } from './layers/ReplayLayer';
import { SurfaceTextureLayer } from './layers/SurfaceTextureLayer';
import {
  TankLayer,
  type TankLayerHandlers,
} from './layers/TankLayer';
import { TerrainLayer } from './layers/TerrainLayer';
import { ReplayPlaybackController } from './replay/ReplayPlaybackController';
import { buildReplayTimeline } from './replay/ReplayTrackBuilder';

export class ViewerEngine {
  private readonly container: HTMLDivElement;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;

  private readonly mapRoot = new THREE.Group();
  private readonly terrainRoot = new THREE.Group();
  private readonly objectRoot = new THREE.Group();
  private readonly effectsRoot = new THREE.Group();

  private readonly replayRoot = new THREE.Group();
  private readonly debugRoot = new THREE.Group();
  private readonly workspaceRoot = new THREE.Group();
  private readonly drawingsRoot = new THREE.Group();
  private readonly tanksRoot = new THREE.Group();

  private readonly api: TBReplaysApi;

  private readonly terrainLayer: TerrainLayer;
  private readonly surfaceTextureLayer: SurfaceTextureLayer;
  private readonly objectMeshLayer: ObjectMeshLayer;
  private readonly mapEffectsLayer: MapEffectsLayer;
  private readonly drawingLayer: DrawingLayer;
  private readonly tankLayer: TankLayer;
  private readonly replayLayer: ReplayLayer;
  private readonly replayPlaybackController = new ReplayPlaybackController();

  private readonly resizeObserver: ResizeObserver;

  private currentMapId: string | null = null;
  private currentCalibration: MapCalibration | null = null;
  private currentManifest: MapManifest | null = null;

  private replayPlaybackChangedHandler: ((state: ReplayPlaybackState) => void) | null = null;
  private lastReplayPlaybackNotificationAt = 0;

  private mode: AppMode = 'workspace';
  private disposed = false;

  public constructor(container: HTMLDivElement) {
    this.container = container;

    const apiBase = import.meta.env.VITE_API_BASE as string | undefined;

    this.api = new TBReplaysApi(apiBase || 'https://localhost:44380');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101418);

    this.camera = new THREE.PerspectiveCamera(
      60,
      this.getAspect(),
      0.1,
      5000,
    );

    this.camera.position.set(0, 420, 620);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
    });

    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
    );

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 20, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.update();

    this.terrainLayer = new TerrainLayer(
      this.terrainRoot,
      this.api,
    );

    this.surfaceTextureLayer = new SurfaceTextureLayer(
      this.api,
      this.renderer,
    );

    this.objectMeshLayer = new ObjectMeshLayer(
      this.objectRoot,
      this.api,
      this.renderer,
    );

    this.mapEffectsLayer = new MapEffectsLayer(
      this.effectsRoot,
      this.api,
    );

    this.drawingLayer = new DrawingLayer(
      this.drawingsRoot,
      this.terrainRoot,
      this.camera,
      this.renderer,
      this.controls,
    );

    this.tankLayer = new TankLayer(
      this.tanksRoot,
      this.terrainRoot,
      this.camera,
      this.renderer,
      this.controls,
    );

    this.replayLayer = new ReplayLayer(this.replayRoot);

    this.configureScene();

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });

    this.resizeObserver.observe(this.container);

    this.renderer.setAnimationLoop((timestamp) => {
      this.render(timestamp);
    });
  }

  public setMode(mode: AppMode): void {
    this.mode = mode;

    this.debugRoot.visible = mode === 'debugCalibration';
    this.workspaceRoot.visible = mode === 'workspace';

    this.drawingLayer.setEnabled(mode === 'workspace');
    this.tankLayer.setEnabled(mode === 'workspace');
  }

  public getCurrentCalibration(): MapCalibration | null {
    return this.currentCalibration;
  }

  public setTool(tool: ViewerTool): void {
    this.drawingLayer.setTool(tool);
    this.tankLayer.setTool(tool);
  }

  public setDrawingColor(color: string): void {
    this.drawingLayer.setColor(color);
  }

  public clearDrawings(): void {
    this.drawingLayer.clear();
  }

  public setManualTanks(tanks: ManualTankModel[]): void {
    this.tankLayer.setManualTanks(tanks);
  }

  public setSelectedManualTankId(tankId: string | null): void {
    this.tankLayer.setSelectedTankId(tankId);
  }

  public setTankLayerHandlers(handlers: TankLayerHandlers): void {
    this.tankLayer.setHandlers(handlers);
  }

  public clearManualTanks(): void {
    this.tankLayer.clear();
  }

  public setReplayPlaybackChangedHandler(
    handler: ((state: ReplayPlaybackState) => void) | null,
  ): void {
    this.replayPlaybackChangedHandler = handler;
  }

  public async importLocalReplay(): Promise<string> {
    const result = await this.api.parseLocalReplay();

    return result.replayId;
  }

  public async loadReplay(replayId: string): Promise<ReplayTimelineSummary> {
    const safeReplayId = replayId.trim();

    if (!safeReplayId) {
      throw new Error('Replay ID пустой.');
    }

    // TODO: Совместный просмотр.
    // Сейчас клиент локально загружает parse-result и строит ReplayTimeline.
    // Потом SignalR должен рассылать только команду loadReplay(replayId, mapId, revision),
    // а каждый браузер сам загрузит parse-result по replayId и повторит сценарий.
    const parseResult = await this.api.getReplayParseResult(safeReplayId);
    const timeline = buildReplayTimeline(safeReplayId, parseResult);

    this.replayLayer.load(timeline, this.currentCalibration);

    const playback = this.replayPlaybackController.loadReplay(
      timeline.replayId,
      timeline.minTime,
      timeline.maxTime,
    );

    this.replayLayer.setTime(playback.time);
    this.notifyReplayPlaybackChanged(playback, true);

    return {
      replayId: timeline.replayId,
      mapName: timeline.mapName,
      mapId: timeline.mapId,
      minTime: timeline.minTime,
      maxTime: timeline.maxTime,
      trackCount: timeline.trackCount,
      sampleCount: timeline.sampleCount,
    };
  }

  public clearReplay(): void {
    this.replayLayer.clear();

    const playback = this.replayPlaybackController.clear();

    this.notifyReplayPlaybackChanged(playback, true);
  }

  public playReplay(): ReplayPlaybackState {
    const playback = this.replayPlaybackController.play(performance.now());

    this.replayLayer.setTime(playback.time);
    this.notifyReplayPlaybackChanged(playback, true);

    return playback;
  }

  public pauseReplay(): ReplayPlaybackState {
    const playback = this.replayPlaybackController.pause();

    this.replayLayer.setTime(playback.time);
    this.notifyReplayPlaybackChanged(playback, true);

    return playback;
  }

  public seekReplayTo(time: number): ReplayPlaybackState {
    const playback = this.replayPlaybackController.seekTo(time);

    this.replayLayer.setTime(playback.time);
    this.notifyReplayPlaybackChanged(playback, true);

    return playback;
  }

  public seekReplayBy(deltaSeconds: number): ReplayPlaybackState {
    const playback = this.replayPlaybackController.seekBy(deltaSeconds);

    this.replayLayer.setTime(playback.time);
    this.notifyReplayPlaybackChanged(playback, true);

    return playback;
  }

  public setReplaySpeed(speed: number): ReplayPlaybackState {
    const playback = this.replayPlaybackController.setSpeed(speed);

    this.notifyReplayPlaybackChanged(playback, true);

    return playback;
  }

  public getReplayPlaybackState(): ReplayPlaybackState {
    return this.replayPlaybackController.getState();
  }

  public async loadMap(mapId: string): Promise<void> {
    const safeMapId = mapId.trim();

    if (!safeMapId) {
      throw new Error('Map ID пустой.');
    }

    this.clearMap();

    const manifest = await this.api.getMapManifest(safeMapId);
    const calibration = await this.tryLoadCalibration(
      safeMapId,
      manifest,
    );

    this.currentMapId = safeMapId;
    this.currentManifest = manifest;
    this.currentCalibration = calibration;

    this.applyCalibration(calibration);

    const terrainTexture = await this.tryLoadTerrainTexture(
      safeMapId,
      calibration,
    );

    this.terrainLayer.setTexture(terrainTexture);

    await this.terrainLayer.load(manifest, calibration);

    this.replayLayer.setCalibration(calibration);

    await Promise.allSettled([
      this.objectMeshLayer.load(safeMapId),
      this.mapEffectsLayer.load(safeMapId, calibration),
    ]);

    this.focusCameraOnObject(this.mapRoot);
  }

  public clearMap(): void {
    this.surfaceTextureLayer.clear();
    this.terrainLayer.clear();
    this.objectMeshLayer.clear();
    this.mapEffectsLayer.clear();
    this.drawingLayer.clear();
    this.tankLayer.clear();

    this.clearReplay();
  }

  public async previewCalibration(calibration: MapCalibration): Promise<void> {
    if (!this.currentMapId || !this.currentManifest) {
      throw new Error('Сначала загрузи карту.');
    }

    this.currentCalibration = calibration;
    this.applyCalibration(calibration);

    const terrainTexture = await this.tryLoadTerrainTexture(
      this.currentMapId,
      calibration,
    );

    this.terrainLayer.setTexture(terrainTexture);

    await this.terrainLayer.load(this.currentManifest, calibration);

    this.replayLayer.setCalibration(calibration);
  }

  public async saveCalibration(
    mapId: string,
    calibration: MapCalibration,
  ): Promise<MapCalibration> {
    const saved = await this.api.saveMapCalibration(mapId, calibration);

    this.currentCalibration = saved;

    await this.previewCalibration(saved);

    return saved;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);

    this.surfaceTextureLayer.dispose();
    this.terrainLayer.dispose();
    this.objectMeshLayer.dispose();
    this.mapEffectsLayer.dispose();
    this.drawingLayer.dispose();
    this.tankLayer.dispose();
    this.replayLayer.dispose();

    this.currentMapId = null;
    this.currentManifest = null;
    this.currentCalibration = null;
    this.replayPlaybackChangedHandler = null;

    this.disposeObject(this.scene);

    this.controls.dispose();
    this.renderer.dispose();

    this.renderer.domElement.remove();
  }

  private applyCalibration(calibration: MapCalibration | null): void {
    const objectHeightOffset = calibration?.objects.heightOffset ?? 0;

    this.objectRoot.position.set(0, objectHeightOffset, 0);
    this.effectsRoot.position.set(0, objectHeightOffset, 0);
  }

  private async tryLoadCalibration(
    mapId: string,
    manifest: MapManifest,
  ): Promise<MapCalibration> {
    try {
      return await this.api.getMapCalibration(mapId);
    } catch (error) {
      console.warn('Map calibration не загрузилась, использую fallback:', error);

      return this.createFallbackCalibration(
        mapId,
        manifest,
      );
    }
  }

  private createFallbackCalibration(
    mapId: string,
    manifest: MapManifest,
  ): MapCalibration {
    return {
      mapId,
      mapKey: mapId,
      replayMapName: null,
      world: {
        horizontalHalfExtent: Math.max(
          manifest.bounds.width,
          manifest.bounds.depth,
        ) / 2,
      },
      height: {
        scale: manifest.bounds.height / 65535,
        offset: manifest.bounds.minZ,
        source: 'frontend-fallback',
        confidence: 0,
        note: 'map_calibration.json не загрузился, создан временный fallback во frontend.',
      },
      terrainTransform: {
        swapXz: false,
        flipX: false,
        flipZ: true,
        rotationDegrees: 0,
      },
      replayTransform: {
        swapXz: false,
        flipX: false,
        flipZ: false,
        rotationDegrees: 0,
      },
      objects: {
        heightOffset: 0,
      },
      texture: {
        rotationDegrees: 0,
        flipU: false,
        flipV: false,
      },
      surface: {
        colorTexturePath: null,
        tileMaskPath: null,
        tileTexture0Path: null,
        landscapeTexturePaths: [],
      },
      heightmapStats: {
        size: manifest.heightmapSize,
        tileSize: manifest.heightmapTileSize,
        rawMin: 0,
        rawMax: 65535,
        rawP01: 0,
        rawP50: 0,
        rawP99: 65535,
      },
    };
  }

  private async tryLoadTerrainTexture(
    mapId: string,
    calibration: MapCalibration | null,
  ): Promise<THREE.Texture | null> {
    try {
      return await this.surfaceTextureLayer.load(
        mapId,
        calibration,
      );
    } catch (error) {
      console.warn('Terrain texture не загрузилась:', error);

      return null;
    }
  }

  private focusCameraOnObject(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);

    if (box.isEmpty()) {
      console.warn('Нечего фокусировать: bounding box пустой.');

      return;
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();

    box.getCenter(center);
    box.getSize(size);

    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = Math.max(250, maxSize * 1.15);

    this.controls.target.copy(center);

    this.camera.position.set(
      center.x,
      center.y + distance * 0.75,
      center.z + distance,
    );

    this.camera.near = 0.1;
    this.camera.far = Math.max(5000, distance * 5);
    this.camera.updateProjectionMatrix();

    this.controls.update();
  }

  private configureScene(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    sunLight.position.set(-250, 600, 300);
    this.scene.add(sunLight);

    this.mapRoot.name = 'map_root';
    this.terrainRoot.name = 'terrain_root';
    this.objectRoot.name = 'object_root';
    this.effectsRoot.name = 'effects_root';

    this.replayRoot.name = 'replay_root';
    this.debugRoot.name = 'debug_root';
    this.workspaceRoot.name = 'workspace_root';
    this.drawingsRoot.name = 'drawings_root';
    this.tanksRoot.name = 'manual_tanks_root';

    this.mapRoot.add(this.terrainRoot);
    this.mapRoot.add(this.objectRoot);
    this.mapRoot.add(this.effectsRoot);

    this.scene.add(this.mapRoot);

    // ReplayRoot намеренно не лежит внутри workspaceRoot/debugRoot.
    // Так replay виден и в рабочем режиме, и в debug/calibration mode.
    this.scene.add(this.replayRoot);

    this.scene.add(this.debugRoot);

    this.workspaceRoot.add(this.drawingsRoot);
    this.workspaceRoot.add(this.tanksRoot);

    this.scene.add(this.workspaceRoot);

    this.addDebugHelpers();
    this.addWorkspacePlaceholder();

    this.setMode(this.mode);
  }

  private addDebugHelpers(): void {
    const axesHelper = new THREE.AxesHelper(220);
    this.debugRoot.add(axesHelper);

    const gridHelper = new THREE.GridHelper(800, 40, 0x334155, 0x1e293b);
    this.debugRoot.add(gridHelper);

    const debugCube = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff3344 }),
    );

    debugCube.position.set(0, 5, 0);
    debugCube.name = 'debug_origin_cube';

    this.debugRoot.add(debugCube);
  }

  private addWorkspacePlaceholder(): void {
    const geometry = new THREE.RingGeometry(24, 26, 64);
    const material = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
    });

    const marker = new THREE.Mesh(geometry, material);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.05;
    marker.name = 'workspace_origin_ring';

    this.workspaceRoot.add(marker);
  }

  private notifyReplayPlaybackChanged(
    playback: ReplayPlaybackState,
    force: boolean,
    timestamp = performance.now(),
  ): void {
    if (!this.replayPlaybackChangedHandler) {
      return;
    }

    if (!force && timestamp - this.lastReplayPlaybackNotificationAt < 100) {
      return;
    }

    this.lastReplayPlaybackNotificationAt = timestamp;
    this.replayPlaybackChangedHandler(playback);
  }

  private render(timestamp: number): void {
    if (this.disposed) {
      return;
    }

    const playback = this.replayPlaybackController.update(timestamp);

    if (playback) {
      this.replayLayer.setTime(playback.time);
      this.notifyReplayPlaybackChanged(playback, false, timestamp);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    if (this.disposed) {
      return;
    }

    this.camera.aspect = this.getAspect();
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight,
    );
  }

  private getAspect(): number {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    return width / height;
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of object.children) {
      this.disposeObject(child);
    }

    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.LineSegments
    ) {
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