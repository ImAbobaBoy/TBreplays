import { API_BASE } from '../api/OnlineHttp';
import type { DrawingStrokeModel } from '../domain/DrawingModels';
import * as THREE from 'three';
import { orbitPanSpeed, orbitWheelDistance } from './OrbitNavigation';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { AppMode } from '../app/AppMode';
import type {
  DrawingArrowMode,
  DrawingLineStyle,
  ViewerTool,
} from '../app/AppState';
import { TBReplaysApi } from '../api/TBReplaysApi';
import type { MapCalibration } from '../domain/MapCalibration';
import type { MapManifest } from '../domain/MapModels';
import type {
  ReplayImportBatchResult,
  ReplayPlaybackState,
  ReplaySessionItem,
  ReplayTeamHealthState,
  ReplayTimelineSummary,
} from '../domain/ReplayModels';
import type {
  ManualTankModel,
  ManualTankPlacementDefaults,
} from '../domain/TankModels';
import type { StrategySnapshot } from '../domain/WorkspaceModels';
import { DrawingLayer } from './layers/DrawingLayer';
import { ObjectMeshLayer } from './layers/ObjectMeshLayer';
import { ReplayLayer } from './layers/ReplayLayer';
import { SurfaceTextureLayer } from './layers/SurfaceTextureLayer';
import {
  TankLayer,
  type TankLayerHandlers,
} from './layers/TankLayer';
import { TerrainLayer } from './layers/TerrainLayer';
import { TacticalPngExportService } from './export/TacticalPngExportService';
import { ReplayPlaybackController } from './replay/ReplayPlaybackController';
import { buildReplayTimeline } from './replay/ReplayTrackBuilder';
import { MapSceneSessionCache } from './MapSceneSessionCache';
import { FreeFlightCamera, type CameraMode } from './FreeFlightCamera';
import type { SceneCamera, ScenePoint, ScenePresenceFrame } from '../domain/ScenePresenceModels';
import { EditorCursorLayer } from './layers/EditorCursorLayer';

type PreparedMap = {
  terrain: TerrainLayer; surface: SurfaceTextureLayer; objects: ObjectMeshLayer;
  terrainGroup: THREE.Group; objectGroup: THREE.Group;
  manifest: MapManifest; calibration: MapCalibration;
  dispose(): void; bytes(): number;
};

export class ViewerEngine {
  private readonly container: HTMLDivElement;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly flightCamera: FreeFlightCamera;
  private cameraMode: CameraMode = 'orbit';
  private drawingAllowed = true;
  private lastFrame = 0;
  private readonly editorCursors = new EditorCursorLayer();
  private editorFrames: ScenePresenceFrame[] = [];
  private followingCamera = false;
  private orbitReferenceDistance = 750;
  private readonly orbitWheel = (event: WheelEvent) => {
    if (this.cameraMode !== 'orbit' || this.followingCamera || !this.controls.enabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = offset.length();
    if (!distance) return;
    offset.multiplyScalar(orbitWheelDistance(distance, event.deltaY, event.deltaMode, this.orbitReferenceDistance * .035) / distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  };
  private remoteCamera: SceneCamera | null = null;
  private presenceHandler: ((cursor: ScenePoint | null, camera: SceneCamera) => void) | null = null;
  private cursorScreen: { x: number; y: number } | null = null;
  private presenceSentAt = 0;
  private presenceJson = '';
  public setScenePresenceHandler(handler: typeof this.presenceHandler): void { this.presenceHandler = handler; this.presenceJson = ''; }
  public setEditorCursors(frames: ScenePresenceFrame[]): void { this.editorFrames = frames; this.editorCursors.sync(frames); }
  public setFollowingCamera(enabled: boolean): void {
    if (enabled === this.followingCamera) return;
    this.followingCamera = enabled; this.remoteCamera = null;
    this.drawingLayer.setNavigationEnabled(!enabled); this.tankLayer.setNavigationEnabled(!enabled);
    this.flightCamera.setEnabled(!enabled && this.cameraMode === 'flight');
    this.controls.enabled = !enabled && this.cameraMode === 'orbit';
  }
  public followCamera(camera: SceneCamera): void { if (this.followingCamera) this.remoteCamera = camera; }
  public getCameraPose(): SceneCamera {
    const target = this.cameraMode === 'flight' ? this.camera.position.clone().addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), 100) : this.controls.target;
    return { position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      quaternion: { x: this.camera.quaternion.x, y: this.camera.quaternion.y, z: this.camera.quaternion.z, w: this.camera.quaternion.w },
      target: { x: target.x, y: target.y, z: target.z }, fov: this.camera.fov };
  }
  private readonly trackCursor = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.cursorScreen = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      && (event.target === this.renderer.domElement || this.renderer.domElement.hasPointerCapture(event.pointerId))
      ? { x: event.clientX, y: event.clientY } : null;
  };
  private readonly hideCursor = () => { this.cursorScreen = null; this.emitScenePresence(true); };
  private emitScenePresence(force = false): void {
    if (!this.presenceHandler || !this.currentMapId) return;
    const now = Date.now();
    if (!force && now - this.presenceSentAt < 50) return;
    let cursor: ScenePoint | null = null;
    if (this.cursorScreen) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((this.cursorScreen.x - rect.left) / rect.width * 2 - 1, -(this.cursorScreen.y - rect.top) / rect.height * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.terrainRoot.children, true)[0];
      if (hit) cursor = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    }
    const camera = this.getCameraPose(); const json = JSON.stringify({ cursor, camera });
    if (!force && json === this.presenceJson && now - this.presenceSentAt < 2000) return;
    this.presenceJson = json; this.presenceSentAt = now; this.presenceHandler(cursor, camera);
  }

  private readonly mapRoot = new THREE.Group();
  private readonly terrainRoot = new THREE.Group();
  private readonly objectRoot = new THREE.Group();

  private readonly replayRoot = new THREE.Group();
  private readonly debugRoot = new THREE.Group();
  private readonly workspaceRoot = new THREE.Group();
  private readonly drawingsRoot = new THREE.Group();
  private readonly tanksRoot = new THREE.Group();

  private readonly api: TBReplaysApi;

  private activeMap: PreparedMap | null = null;
  private readonly mapCache = new MapSceneSessionCache<PreparedMap>(id => this.prepareMap(id));
  private preloadGeneration = 0;
  private readonly replayPresentations = new Map<string, ReturnType<TBReplaysApi['getReplayPresentation']>>();
  private readonly drawingLayer: DrawingLayer;
  private readonly tankLayer: TankLayer;
  private readonly replayLayer: ReplayLayer;
  private readonly replayPlaybackController = new ReplayPlaybackController();
  private readonly tacticalPngExportService = new TacticalPngExportService();

  private readonly resizeObserver: ResizeObserver;

  private mapLoadGeneration = 0;
  private currentMapId: string | null = null;
  private currentCalibration: MapCalibration | null = null;
  private currentManifest: MapManifest | null = null;

  private replayPlaybackChangedHandler: ((state: ReplayPlaybackState) => void) | null = null;
  private lastReplayPlaybackNotificationAt = 0;

  private mode: AppMode = 'workspace';
  private disposed = false;
  private replayLoadGeneration = 0;
  private selectedTool: ViewerTool = 'select';
  private pointerStart = { x: 0, y: 0 };
  private readonly beginReplaySelection = (event: PointerEvent) => { this.pointerStart = { x: event.clientX, y: event.clientY }; };
  private readonly selectReplayTank = (event: MouseEvent) => {
    if (this.cameraMode === 'flight' || this.selectedTool !== 'select' || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1,
      -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    this.replayLayer.selectAt(ray);
  };

  public constructor(container: HTMLDivElement) {
    this.container = container;

    this.api = new TBReplaysApi(API_BASE);

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

    this.flightCamera = new FreeFlightCamera(this.camera, this.renderer.domElement);
    this.renderer.domElement.addEventListener('wheel', this.orbitWheel, { capture: true, passive: false });
    window.addEventListener('pointermove', this.trackCursor, true);
    window.addEventListener('blur', this.hideCursor);
    this.renderer.domElement.addEventListener('pointerleave', this.hideCursor);
    this.scene.add(this.editorCursors.root);


    this.tankLayer = new TankLayer(
      this.tanksRoot,
      this.terrainRoot,
      this.camera,
      this.renderer,
      this.controls,
    );

    this.drawingLayer = new DrawingLayer(
      this.drawingsRoot,
      this.terrainRoot,
      this.camera,
      this.renderer,
      this.controls,
    );

    this.replayLayer = new ReplayLayer(this.replayRoot);
    this.drawingLayer.eraseOther = (raycaster, erased) => this.tankLayer.eraseAt(raycaster, erased);
    this.renderer.domElement.addEventListener('pointerdown', this.beginReplaySelection);
    this.renderer.domElement.addEventListener('click', this.selectReplayTank);

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

    this.updateDrawingAccess();
    this.tankLayer.setEnabled(mode === 'workspace');
  }

  public setCameraMode(mode: CameraMode): void {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;
    this.drawingLayer.setCameraMode(mode); this.tankLayer.setCameraMode(mode);
    this.flightCamera.setEnabled(!this.followingCamera && mode === 'flight');
    this.controls.enabled = !this.followingCamera && mode === 'orbit';
    if (mode === 'orbit') {
      const distance = Math.max(10, this.camera.position.distanceTo(this.controls.target));
      this.controls.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), distance);
      this.controls.update();
    }
    this.updateDrawingAccess();
  }
  public setCameraSpeed(speed: number): void { this.flightCamera.setSpeed(speed); }
  public setCameraSpeedHandler(handler: ((speed: number) => void) | null): void { this.flightCamera.onSpeedChanged = handler; }
  private updateDrawingAccess(): void {
    const allowed = this.drawingAllowed && this.mode === 'workspace';
    this.drawingLayer.setEnabled(allowed); this.tankLayer.setEditable(allowed);
    if (this.cameraMode === 'flight' || this.followingCamera) this.controls.enabled = false;
  }

  public getCurrentCalibration(): MapCalibration | null {
    return this.currentCalibration;
  }

  public setTool(tool: ViewerTool): void {
    this.selectedTool = tool;
    this.drawingLayer.setTool(tool);
    this.tankLayer.setTool(tool);
  }

  public setDrawingColor(color: string): void {
    this.drawingLayer.setColor(color);
  }

  public setDrawingWidth(width: number): void {
    this.drawingLayer.setWidth(width);
  }
  public setDrawingText(text: string, size: number): void { this.drawingLayer.setText(text, size); }

  public setDrawingLineStyle(lineStyle: DrawingLineStyle): void {
    this.drawingLayer.setLineStyle(lineStyle);
  }

  public setDrawingArrowMode(arrowMode: DrawingArrowMode): void {
    this.drawingLayer.setArrowMode(arrowMode);
  }

  public setOnlineDrawingAccess(allowed: boolean): void {
    this.drawingAllowed = allowed; this.updateDrawingAccess();
  }
  public setTankOnlineHandlers(handlers: import('./layers/TankLayer').TankOnlineHandlers | null): void {
    this.tankLayer.setOnlineHandlers(handlers);
  }
  public setDrawingHandlers(handlers: { upsert: (stroke: DrawingStrokeModel) => void; remove: (id: string) => void } | null): void {
    this.drawingLayer.setOnlineHandlers(handlers);
  }
  public syncOnlineStrokes(strokes: DrawingStrokeModel[], reset = false): void {
    if (reset) this.drawingLayer.clear();
    this.drawingLayer.syncStrokes(strokes);
  }
  public clearDrawings(): void {
    this.drawingLayer.clear();
  }

  public setManualTanks(tanks: ManualTankModel[]): void {
    this.tankLayer.setManualTanks(tanks);
  }

  public setTankPlacementDefaults(defaults: ManualTankPlacementDefaults): void {
    this.tankLayer.setPlacementDefaults(defaults);
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

  public captureStrategySnapshot(selectedManualTankId: string | null): StrategySnapshot {
    return {
      manualTanks: this.tankLayer.getManualTanks(),
      selectedManualTankId,
      strokes: this.drawingLayer.getStrokes(),
    };
  }

  public applyStrategySnapshot(snapshot: StrategySnapshot): void {
    // TODO: Временное MVP-решение.
    // Сейчас Slides переключают локальный StrategySnapshot прямо через ViewerEngine без backend persistence.
    // Потом заменить на загрузку/сохранение StrategyDocument по slideId/mapId из backend.
    // Убрать direct apply из workspace, когда появится серверная модель стратегий.
    this.drawingLayer.setStrokes(snapshot.strokes);
    this.tankLayer.setManualTanks(snapshot.manualTanks);
    this.tankLayer.setSelectedTankId(snapshot.selectedManualTankId);
  }


  public async exportStrategyPng(includeReplay = true): Promise<string> {
    if (!this.currentManifest) {
      throw new Error('Сначала загрузи карту, потом экспортируй тактику.');
    }

    const safeMapId = (this.currentMapId ?? 'map').trim() || 'map';
    const fileName = `${safeMapId}_tactic.png`;

    const cursorsVisible = this.editorCursors.root.visible;
    this.editorCursors.root.visible = false;
    try { await this.tacticalPngExportService.export({
      scene: this.scene,
      renderer: this.renderer,
      mapRoot: this.mapRoot,
      replayRoot: this.replayRoot,
      includeReplay,
      debugRoot: this.debugRoot,
      workspaceRoot: this.workspaceRoot,
      calibration: this.currentCalibration,
      manualTanks: this.tankLayer.getManualTanks(),
      strokes: this.drawingLayer.getStrokes(),
      fileName,
      width: 2048,
      height: 2048,
    }); } finally { this.editorCursors.root.visible = cursorsVisible; }

    return fileName;
  }

  public setReplayPlaybackChangedHandler(
    handler: ((state: ReplayPlaybackState) => void) | null,
  ): void {
    this.replayPlaybackChangedHandler = handler;
  }

  public async importLocalReplay(): Promise<string> {
    const result = await this.api.importLocalReplay();

    if (!result.success || !result.replayId) {
      throw new Error(result.error || 'Локальный replay не импортирован.');
    }

    return result.replayId;
  }

  public async importReplayFiles(files: File[]): Promise<ReplayImportBatchResult> {
    return await this.api.importReplayFiles(files);
  }

  public async getCurrentSessionReplays(mapName: string): Promise<ReplaySessionItem[]> {
    return await this.api.getCurrentSessionReplays(mapName);
  }

  public async loadReplay(replayId: string): Promise<ReplayTimelineSummary> {
    const safeReplayId = replayId.trim();

    if (!safeReplayId) {
      throw new Error('Replay ID пустой.');
    }

    const generation = ++this.replayLoadGeneration;
    let pending = this.replayPresentations.get(safeReplayId);
    if (!pending) {
      pending = this.api.getReplayPresentation(safeReplayId).catch(error => {
        this.replayPresentations.delete(safeReplayId); throw error;
      });
      this.replayPresentations.set(safeReplayId, pending);
    }
    const presentation = await pending;
    if (this.disposed || generation !== this.replayLoadGeneration) throw new Error('Загрузка реплея отменена.');
    const timeline = buildReplayTimeline(safeReplayId, presentation);

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
    this.replayLoadGeneration++;
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

  public synchronizeReplay(time: number, speed: number, playing: boolean): ReplayPlaybackState {
    const playback = this.replayPlaybackController.synchronize(time, speed, playing, performance.now());
    this.replayLayer.setTime(playback.time);
    this.notifyReplayPlaybackChanged(playback, true);
    return playback;
  }

  public getReplayPlaybackState(): ReplayPlaybackState {
    return this.replayPlaybackController.getState();
  }

  public getReplayTeamHealthState(time?: number): ReplayTeamHealthState | null {
    const playback = this.replayPlaybackController.getState();

    return this.replayLayer.getTeamHealthState(time ?? playback.time);
  }

  public async loadMap(mapId: string): Promise<void> {
    const safeMapId = mapId.trim();

    if (!safeMapId) {
      throw new Error('Map ID пустой.');
    }

    if (this.disposed) throw new Error('Просмотрщик уже закрыт');
    this.clearMap();
    const generation = this.mapLoadGeneration;
    const checkCurrent = () => { if (this.disposed || generation !== this.mapLoadGeneration) throw new Error('Загрузка карты отменена'); };

    const prepared = await this.mapCache.get(safeMapId);
    checkCurrent();
    const { manifest, calibration } = prepared;
    this.activeMap = prepared;
    this.terrainRoot.add(prepared.terrainGroup);
    this.objectRoot.add(prepared.objectGroup);
    this.currentMapId = safeMapId;
    this.currentManifest = manifest;
    this.currentCalibration = calibration;

    this.applyCalibration(calibration);

    this.focusCameraOnObject(this.terrainRoot);
    this.controls.enabled = !this.followingCamera && this.cameraMode === 'orbit';
    this.replayLayer.setCalibration(calibration);

  }

  public clearMap(): void {
    this.cursorScreen = null; this.remoteCamera = null; this.setEditorCursors([]);
    this.mapLoadGeneration++;
    this.preloadGeneration++;
    this.controls.enabled = !this.followingCamera && this.cameraMode === 'orbit';
    this.terrainRoot.clear();
    this.objectRoot.clear();
    this.activeMap = null;
    this.currentMapId = null;
    this.currentManifest = null;
    this.currentCalibration = null;
    this.drawingLayer.clear();
    this.tankLayer.clear();

    this.clearReplay();
  }

  public async previewCalibration(calibration: MapCalibration): Promise<void> {
    if (!this.currentMapId || !this.currentManifest) {
      throw new Error('Сначала загрузи карту.');
    }

    this.currentCalibration = calibration;
    if (!this.activeMap) return;
    this.activeMap.calibration = calibration;
    this.applyCalibration(calibration);

    const terrainTexture = await this.tryLoadTerrainTexture(
      this.currentMapId,
      calibration, this.activeMap.surface,
    );

    this.activeMap.terrain.setTexture(terrainTexture);

    await this.activeMap.terrain.load(this.currentManifest, calibration);
    await this.activeMap.objects.load(this.currentMapId, new THREE.Box3().setFromObject(this.terrainRoot));

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
    this.renderer.domElement.removeEventListener('wheel', this.orbitWheel, true);
    this.renderer.domElement.removeEventListener('pointerdown', this.beginReplaySelection);
    this.renderer.domElement.removeEventListener('click', this.selectReplayTank);
    this.mapLoadGeneration++;
    this.replayLoadGeneration++;

    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('pointermove', this.trackCursor, true);
    window.removeEventListener('blur', this.hideCursor);
    this.renderer.domElement.removeEventListener('pointerleave', this.hideCursor);
    this.editorCursors.dispose(); this.presenceHandler = null;
    this.flightCamera.dispose();

    this.preloadGeneration++;
    this.terrainRoot.clear(); this.objectRoot.clear();
    this.mapCache.dispose();
    this.replayPresentations.clear();
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
    surface: SurfaceTextureLayer,
  ): Promise<THREE.Texture | null> {
    try {
      return await surface.load(
        mapId,
        calibration,
      );
    } catch (error) {
      console.warn('Terrain texture не загрузилась:', error);

      return null;
    }
  }

  public preloadMaps(ids: string[]): void {
    const generation = ++this.preloadGeneration;
    // One background map at a time; foreground requests share an in-flight load.
    void (async () => {
      for (const id of new Set(ids)) {
        if (this.disposed || generation !== this.preloadGeneration) return;
        if (this.mapCache.has(id)) continue;
        await new Promise(resolve => window.setTimeout(resolve, 100));
        if (this.disposed || generation !== this.preloadGeneration) return;
        try {
          await this.mapCache.get(id, false);
          if (!this.mapCache.has(id)) return; // Visited maps already use the available budget.
        }
        catch (error) { if (!this.disposed) console.warn('Фоновая загрузка карты:', id, error); }
      }
    })();
  }

  private async prepareMap(id: string): Promise<PreparedMap> {
    const terrainGroup = new THREE.Group(), objectGroup = new THREE.Group();
    const terrain = new TerrainLayer(terrainGroup, this.api);
    const surface = new SurfaceTextureLayer(this.api, this.renderer);
    const objects = new ObjectMeshLayer(objectGroup, this.api, this.renderer);
    const dispose = () => { terrain.dispose(); objects.dispose(); surface.dispose(); };
    try {
      const manifest = await this.api.getMapManifest(id);
      const calibration = await this.tryLoadCalibration(id, manifest);
      if (this.disposed) throw new Error('Просмотрщик закрыт.');
      const results = await Promise.allSettled([
        this.tryLoadTerrainTexture(id, calibration, surface).then(texture => {
          if (!texture) throw new Error('Не удалось загрузить поверхность карты. Повторите загрузку.');
          terrain.setTexture(texture);
        }),
        terrain.load(manifest, calibration).then(() => objects.load(id, new THREE.Box3().setFromObject(terrainGroup))),
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (this.disposed) throw new Error('Просмотрщик закрыт.');
      return { terrain, surface, objects, terrainGroup, objectGroup, manifest, calibration, dispose,
        bytes: () => this.estimateMapBytes([terrainGroup, objectGroup]) };
    } catch (error) { dispose(); throw error; }
  }

  private estimateMapBytes(roots: THREE.Group[]): number {
    let bytes = 0;
    const seen = new Set<unknown>();
    for (const root of roots) root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!seen.has(object.geometry)) {
        seen.add(object.geometry);
        for (const attribute of Object.values(object.geometry.attributes) as THREE.BufferAttribute[]) bytes += attribute.array.byteLength;
        bytes += object.geometry.index?.array.byteLength ?? 0;
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        const texture = (material as THREE.MeshStandardMaterial).map;
        if (!texture || seen.has(texture)) continue;
        seen.add(texture);
        const image = texture.image as { width?: number; height?: number } | undefined;
        bytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 4 / 3;
      }
    });
    return bytes;
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
    this.orbitReferenceDistance = distance * 1.25;

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

    this.replayRoot.name = 'replay_root';
    this.debugRoot.name = 'debug_root';
    this.workspaceRoot.name = 'workspace_root';
    this.drawingsRoot.name = 'drawings_root';
    this.tanksRoot.name = 'manual_tanks_root';

    this.mapRoot.add(this.terrainRoot);
    this.mapRoot.add(this.objectRoot);

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

    if (this.followingCamera) {
      this.controls.enabled = false;
      if (this.remoteCamera) {
        const pose = this.remoteCamera;
        const dt = this.lastFrame ? Math.min(.1, (timestamp - this.lastFrame) / 1000) : 1;
        const alpha = 1 - Math.exp(-18 * dt);
        this.camera.position.lerp(new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z), alpha);
        this.camera.quaternion.slerp(new THREE.Quaternion(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w).normalize(), alpha);
        this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
        this.camera.fov = pose.fov;
        this.camera.far = Math.max(5000, this.camera.position.distanceTo(this.controls.target) * 5);
        this.camera.updateProjectionMatrix();
      }
    }
    else if (this.cameraMode === 'flight') this.flightCamera.update(this.lastFrame ? (timestamp - this.lastFrame) / 1000 : 0);
    else { this.controls.panSpeed = orbitPanSpeed(this.camera.position.distanceTo(this.controls.target), this.orbitReferenceDistance); this.controls.update(); }
    this.lastFrame = timestamp;
    this.replayLayer.updateView(this.camera, this.renderer.domElement.clientHeight);
    this.editorCursors.sync(this.editorFrames);
    this.editorCursors.updateView(this.camera, this.renderer.domElement.clientHeight);
    this.emitScenePresence();
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
          if (material) material.dispose();
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
