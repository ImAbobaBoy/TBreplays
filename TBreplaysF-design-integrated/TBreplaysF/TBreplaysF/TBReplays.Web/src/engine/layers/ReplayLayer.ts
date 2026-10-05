import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import type { MapCalibration } from '../../domain/MapCalibration';
import type {
  ParsedReplayVisibilityInterval,
  ParsedReplayShotEvent,
  ReplayMovementTrack,
  ReplayPose,
  ReplayTeamHealthState,
  ReplayTimeline,
} from '../../domain/ReplayModels';
import type { ManualTankModel } from '../../domain/TankModels';
import { mapReplayPositionToThree } from '../MapCalibrationTransforms';
import { shotRayEnd } from '../replay/ReplayShotGeometry';
import { selectReplayReload } from '../replay/ReplayReload';
import { updateReplayTankPlate } from '../replay/ReplayTankPlate';
import { replayTankColor, replayPathColor, replayPathProgress } from '../replay/ReplayColors';
import {
  findLastVisibleSampleTime,
  findLastVisibleTime,
  findLatestByTime,
  selectReplayHud,
  getReplayTeamKind,
  sampleTrackAtTime,
  sampleTrackLatestAtTime,
  splitSamplesByVisibilityIntervals,
} from '../replay/ReplayTrackBuilder';
import {
  applyTankModelToVisual,
  createTankVisual,
  disposeTankVisual,
  type TankVisual,
} from '../tanks/TankMeshFactory';

type ReplayTankEntry = {
  track: ReplayMovementTrack;
  visual: TankVisual;
  trackGroup: THREE.Group;
  consumableSprites: THREE.Sprite[];
  activeEffectGlow: THREE.Sprite;
  lastRenderedLabel: string | null;
};

type ReplayShotLineEntry = {
  event: ParsedReplayShotEvent;
  object: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
};

type ReplayVisibilityState = {
  hasVisibilityData: boolean;
  isVisible: boolean;
  hasBeenVisible: boolean;
  lastVisibleTime: number | null;
  intervals: ParsedReplayVisibilityInterval[];
};

const DIMMED_ENEMY_COLOR = '#4a1717';

const INVISIBLE_TANK_OPACITY = 0.45;
const INVISIBLE_LABEL_OPACITY = 0.7;
const VISIBLE_TRACK_OPACITY = 0.82;
const INVISIBLE_TRACK_OPACITY = 0.24;
const SHOT_LINE_LIFETIME_SECONDS = 3;
const SHOT_LINE_LENGTH = 260;
const SHOT_LINE_RADIUS = 0.32;
const CONSUMABLE_INDICATOR_LIFETIME_SECONDS = 5;
const MAX_VISIBLE_CONSUMABLE_INDICATORS = 4;
const TRACK_PATH_MAX_SAMPLE_GAP_SECONDS = 1.5;


export class ReplayLayer {
  private readonly root: THREE.Group;
  private readonly tracksRoot = new THREE.Group();
  private readonly tanksRoot = new THREE.Group();
  private readonly shotLinesRoot = new THREE.Group();
  private readonly tankEntries = new Map<number, ReplayTankEntry>();
  private readonly shotLineEntries: ReplayShotLineEntry[] = [];

  private timeline: ReplayTimeline | null = null;
  private calibration: MapCalibration | null = null;
  private currentTime = 0;
  private selectedEntityId: number | null = null;

  public selectAt(raycaster: THREE.Raycaster): void {
    const hit = raycaster.intersectObjects([...this.tankEntries.values()].filter(entry => entry.visual.root.visible).map(entry => entry.visual.root), true)[0];
    let object: THREE.Object3D | null = hit?.object ?? null;
    while (object && object.userData.replayEntityId === undefined) object = object.parent;
    this.selectEntity(object ? Number(object.userData.replayEntityId) : null);
  }

  public selectEntity(entityId: number | null): void {
    this.selectedEntityId = entityId !== null && this.tankEntries.has(entityId) ? entityId : null;
    this.setTime(this.currentTime);
  }

  public getSelectedEntity(): number | null { return this.selectedEntityId; }
  public getPathInfo(entityId: number): { distance: number; startTime: number | null; endTime: number | null } | null {
    return this.tankEntries.get(entityId)?.trackGroup.userData.pathInfo ?? null;
  }

  public constructor(root: THREE.Group) {
    this.root = root;

    this.tracksRoot.name = 'replay_tracks_root';
    this.tanksRoot.name = 'replay_tanks_root';
    this.shotLinesRoot.name = 'replay_shot_lines_root';

    this.root.add(this.tracksRoot);
    this.root.add(this.tanksRoot);
    this.root.add(this.shotLinesRoot);
  }

  public load(
    timeline: ReplayTimeline,
    calibration: MapCalibration | null,
  ): void {
    this.clear();

    this.timeline = timeline;
    this.calibration = calibration;
    this.currentTime = timeline.minTime;

    for (let i = 0; i < timeline.tracks.length; i++) {
      const track = timeline.tracks[i];
      const color = this.getTrackVisualColor(track, false);
      const trackGroup = this.createMovementPath(track, color, timeline);

      this.tracksRoot.add(trackGroup);

      const visual = createTankVisual(this.createTankModel(
        track,
        color,
        null,
        timeline.minTime,
      ));
      visual.root.traverse(object => { object.userData.replayEntityId = track.entityId; });
      trackGroup.userData.replayEntityId = track.entityId;
      const consumableSprites = this.createConsumableSprites();
      const activeEffectGlow = this.createActiveEffectGlowSprite();

      visual.root.add(activeEffectGlow);

      for (const sprite of consumableSprites) {
        visual.root.add(sprite);
      }

      this.tanksRoot.add(visual.root);

      this.tankEntries.set(track.entityId, {
        track,
        visual,
        trackGroup,
        consumableSprites,
        activeEffectGlow,
        lastRenderedLabel: null,
      });
    }

    this.createShotLines(timeline);
    this.setTime(timeline.minTime);
  }

  public setCalibration(calibration: MapCalibration | null): void {
    this.calibration = calibration;

    if (!this.timeline) {
      return;
    }

    // TODO: Временное MVP-решение.
    // Сейчас при изменении map_calibration.json пересоздаём replay layer целиком,
    // чтобы траектории, tank labels, shot-lines и consumable indicators пересчитались по новой системе координат.
    // Потом заменить на ReplayCoordinateMapper и точечное обновление geometry/positions без полного rebuild.
    const timeline = this.timeline;
    const time = this.currentTime;

    this.load(timeline, calibration);
    this.setTime(time);
  }

  public setTime(time: number): void {
    this.currentTime = time;

    for (const entry of this.tankEntries.values()) {
      this.updateTankAtTime(entry, time);
    }

    this.updateShotLines(time);
  }
  public updateView(camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    // A world-space subpixel cylinder disappears in the full-map view. Keep a 3px tracer.
    const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, viewportHeight);
    for (const entry of this.shotLineEntries) {
      if (!entry.object.visible) continue;
      const radius = Math.max(SHOT_LINE_RADIUS, camera.position.distanceTo(entry.object.position) * worldPerPixel * 1.5);
      entry.object.scale.set(radius / SHOT_LINE_RADIUS, 1, radius / SHOT_LINE_RADIUS);
    }
  }

  public getTeamHealthState(time = this.currentTime): ReplayTeamHealthState | null {
    return this.timeline ? selectReplayHud(this.timeline, time) : null;
  }

  public clear(): void {
    this.timeline = null;
    this.selectedEntityId = null;
    this.currentTime = 0;

    for (const entry of this.tankEntries.values()) {
      this.tanksRoot.remove(entry.visual.root);
      disposeTankVisual(entry.visual);
    }

    this.tankEntries.clear();
    this.shotLineEntries.length = 0;
    this.clearGroup(this.tracksRoot);
    this.clearGroup(this.shotLinesRoot);
  }

  public dispose(): void {
    this.clear();
  }

  private updateTankAtTime(
    entry: ReplayTankEntry,
    time: number,
  ): void {
    const visibility = this.getVisibilityState(entry.track, time);
    const isEnemy = this.isEnemyTrack(entry.track);

    if (isEnemy && visibility.hasVisibilityData && !visibility.hasBeenVisible) {
      entry.visual.root.visible = false;
      this.setTrackAppearance(entry.trackGroup, DIMMED_ENEMY_COLOR, INVISIBLE_TRACK_OPACITY);
      return;
    }

    const isDead = this.isTrackDead(entry.track, time);
    const isHiddenEnemy = isEnemy && visibility.hasVisibilityData && !visibility.isVisible;
    const poseTime = isDead
      ? this.getTrackDeathTime(entry.track) ?? time
      : isHiddenEnemy
        ? findLastVisibleSampleTime(entry.track, visibility.intervals, time) ?? visibility.lastVisibleTime ?? time
        : time;

    const pose = isHiddenEnemy
      ? sampleTrackLatestAtTime(entry.track, poseTime) ?? sampleTrackLatestAtTime(entry.track, time)
      : sampleTrackAtTime(entry.track, poseTime)
        ?? sampleTrackLatestAtTime(entry.track, poseTime)
        ?? sampleTrackLatestAtTime(entry.track, time);

    if (!pose) {
      entry.visual.root.visible = false;
      this.setTrackAppearance(entry.trackGroup, DIMMED_ENEMY_COLOR, INVISIBLE_TRACK_OPACITY);
      return;
    }

    entry.visual.root.visible = true;

    const isDimmed = isHiddenEnemy || isDead;
    const displayedHealth = this.getDisplayedHealth(entry.track, time);

    const model = this.createTankModel(
      entry.track,
      this.getTrackVisualColor(entry.track, false),
      displayedHealth,
      time,
      pose,
    );

    const turretFrame = this.timeline
      ? findLatestByTime(
        this.timeline.turretFramesByEntityId.get(entry.track.entityId) ?? [],
        poseTime,
      )
      : null;

    if (turretFrame) {
      model.pose.turretYawDegrees = this.calculateTurretYawDegrees(
        pose.yawRadians,
        turretFrame.turretYawRadians,
      );
    }

    applyTankModelToVisual(model, entry.visual);
    entry.visual.selectionRing.visible = entry.track.entityId === this.selectedEntityId;
    const visualColor = this.getTrackVisualColor(entry.track, isDimmed);

    this.setTankVisualAppearance(entry.visual, visualColor, isDimmed);
    this.setTrackAppearance(
      entry.trackGroup,
      visualColor,
      isDimmed ? INVISIBLE_TRACK_OPACITY : VISIBLE_TRACK_OPACITY,
    );
    this.updateConsumableIndicators(entry, time, isDimmed);
    this.updateActiveEffectGlow(entry, time, isDimmed);
    const vehicle = this.timeline?.presentation.vehicles.find(v => v.entityId === entry.track.entityId);
    const reload = this.timeline?.presentation.playback?.vehicles.find(v => v.entityId === entry.track.entityId)?.reload;
    updateReplayTankPlate(entry.visual.labelSprite, entry.track.nickname || entry.track.entityHex,
      vehicle?.vehicleName ?? vehicle?.vehicleKey ?? '', displayedHealth,
      vehicle?.initialHp ?? vehicle?.effectiveHp ?? null,
      this.getVehicleState(entry.track.entityId, time)?.healthIsLastKnown ?? false,
      !isEnemy && !isDead ? selectReplayReload(reload ?? [], time).fraction : null, isEnemy);
    entry.lastRenderedLabel = model.label;
  }

  private createTankModel(
    track: ReplayMovementTrack,
    color: string,
    displayedHealth: number | null,
    time: number,
    pose?: ReplayPose,
  ): ManualTankModel {
    const actualPose = pose ?? sampleTrackAtTime(track, time) ?? sampleTrackLatestAtTime(track, time);
    const position = actualPose
      ? mapReplayPositionToThree(
        actualPose.x,
        actualPose.y + this.getReplayTankVerticalOffset(),
        actualPose.z,
        this.calibration,
      )
      : new THREE.Vector3();

    const bodyYawDegrees = actualPose
      ? this.calculateBodyYawDegrees(actualPose.yawRadians)
      : 0;

    const vehicleClass = this.timeline?.presentation.vehicles.find(v => v.entityId === track.entityId)?.vehicleClass;

    return {
      id: `replay-${track.entityId}`,
      coordinateSpace: 'viewer-world-v1',
      label: this.createTankLabel(track, displayedHealth).replace('HP ', this.getVehicleState(track.entityId, time)?.healthIsLastKnown ? 'HP ≈ ' : 'HP '),
      visualKey: vehicleClass === 'heavyTank' ? 'heavy'
        : vehicleClass === 'lightTank' ? 'light'
        : vehicleClass === 'AT-SPG' ? 'td' : 'medium',
      team: getReplayTeamKind(track.teamId, this.timeline?.recorderTeamId ?? null),
      color,
      pose: {
        x: position.x,
        y: position.y,
        z: position.z,
        bodyYawDegrees,
        turretYawDegrees: 0,
      },
    };
  }

  private createMovementPath(
    track: ReplayMovementTrack,
    color: string,
    timeline: ReplayTimeline,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `replay_track_${track.entityHex}`;

    const deathTime = this.getTrackDeathTime(track);
    const all = [...track.samples].sort((a, b) => a.time - b.time);
    const ordered = all.filter(sample => deathTime == null || sample.time <= deathTime);
    const last = ordered[ordered.length - 1];
    if (deathTime != null && last && last.time < deathTime) {
      const next = all.find(sample => sample.time > deathTime);
      const pose = next && next.segmentIndex === last.segmentIndex && next.time - last.time <= TRACK_PATH_MAX_SAMPLE_GAP_SECONDS
        ? sampleTrackAtTime(track, deathTime) : null;
      if (pose) ordered.push({ ...last, time: deathTime, x: pose.x, y: pose.y, z: pose.z, yawRadians: pose.yawRadians });
    }

    if (ordered.length < 2) {
      return group;
    }

    const intervals = this.isEnemyTrack(track)
      ? timeline.visibilityIntervalsByEntityId.get(track.entityId) ?? []
      : [];
    const sampleSegments = this.createMovementPathSegments(track, ordered, intervals);
    sampleSegments.sort((a, b) => a[0].time - b[0].time);
    const progress = replayPathProgress(sampleSegments);
    group.userData.pathInfo = { distance: progress.distance, startTime: progress.startTime, endTime: progress.endTime };

    for (let segmentIndex = 0; segmentIndex < sampleSegments.length; segmentIndex++) {
      const segmentSamples = sampleSegments[segmentIndex];

      if (segmentSamples.length < 2) {
        continue;
      }

      const line = this.createMovementPathLine(
        track,
        segmentSamples,
        color,
        segmentIndex,
        progress.fractions,
      );

      if (line) {
        group.add(line);
      }
    }

    return group;
  }

  private createMovementPathSegments(
    track: ReplayMovementTrack,
    ordered: ReplayMovementTrack['samples'],
    intervals: ParsedReplayVisibilityInterval[],
  ): ReplayMovementTrack['samples'][] {
    const visibleSampleGroups = this.isEnemyTrack(track) && intervals.length > 0
      ? splitSamplesByVisibilityIntervals({ ...track, samples: ordered }, intervals)
      : [ordered];
    const result: ReplayMovementTrack['samples'][] = [];

    for (const samples of visibleSampleGroups) {
      result.push(...this.splitSamplesByReplayContinuity(samples));
    }

    return result;
  }

  private splitSamplesByReplayContinuity(
    samples: ReplayMovementTrack['samples'],
  ): ReplayMovementTrack['samples'][] {
    if (samples.length < 2) {
      return [];
    }

    const result: ReplayMovementTrack['samples'][] = [];
    let current: ReplayMovementTrack['samples'] = [samples[0]];

    for (let i = 1; i < samples.length; i++) {
      const previous = current[current.length - 1];
      const sample = samples[i];
      const isSameReplaySegment = sample.segmentIndex === previous.segmentIndex;
      const isContinuousInTime = sample.time - previous.time <= TRACK_PATH_MAX_SAMPLE_GAP_SECONDS;

      if (!isSameReplaySegment || !isContinuousInTime) {
        if (current.length >= 2) {
          result.push(current);
        }

        current = [sample];
        continue;
      }

      current.push(sample);
    }

    if (current.length >= 2) {
      result.push(current);
    }

    return result;
  }

  private createMovementPathLine(
    track: ReplayMovementTrack,
    samples: ReplayMovementTrack['samples'],
    color: string,
    segmentIndex: number,
    progress: Map<ReplayMovementTrack['samples'][number], number>,
  ): Line2 | null {
    const pathStep = Math.max(1, Math.floor(samples.length / 900));
    const pathSamples = samples.filter((_, index) => index % pathStep === 0 || index === samples.length - 1);

    if (pathSamples.length < 2) {
      return null;
    }

    const positions = new Float32Array(pathSamples.length * 3);
    const colors = new Float32Array(pathSamples.length * 3);
    const timeColor = new THREE.Color();

    for (let i = 0; i < pathSamples.length; i++) {
      const sample = pathSamples[i];
      const position = mapReplayPositionToThree(
        sample.x,
        sample.y + 0.15,
        sample.z,
        this.calibration,
      );
      const offset = i * 3;

      positions[offset] = position.x;
      positions[offset + 1] = position.y;
      positions[offset + 2] = position.z;
      replayPathColor(progress.get(sample) ?? 0, timeColor).toArray(colors, offset);
    }

    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);

    geometry.computeBoundingSphere();

    const material = new LineMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: VISIBLE_TRACK_OPACITY,
      depthWrite: false,
      depthTest: true,
      linewidth: 1,
      worldUnits: false,
    });

    const line = new Line2(geometry, material);
    line.name = `replay_track_${track.entityHex}_${segmentIndex}`;

    return line;
  }

  private createShotLines(timeline: ReplayTimeline): void {
    for (const event of timeline.shotEvents) {
      const track = timeline.tracks.find((item) => item.entityId === event.shooterEntityId);

      if (!track) {
        continue;
      }

      const line = this.createShotLine(event, track, timeline);

      if (!line) {
        continue;
      }

      this.shotLinesRoot.add(line.object);
      this.shotLineEntries.push(line);
    }
  }

  private createShotLine(
    event: ParsedReplayShotEvent,
    track: ReplayMovementTrack,
    timeline: ReplayTimeline,
  ): ReplayShotLineEntry | null {
    const pose = sampleTrackAtTime(track, event.time) ?? sampleTrackLatestAtTime(track, event.time);
    const origin = this.getShotOrigin(event) ?? (pose ? mapReplayPositionToThree(pose.x, pose.y + 3, pose.z, this.calibration) : null);

    if (!origin) {
      return null;
    }

    const target = this.getShotTarget(event, timeline) ?? this.getShotFallbackTarget(event, origin);

    if (!target) {
      return null;
    }

    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.isEnemyTrack(track) ? '#ffac86' : '#fff4a3'),
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
    });
    const object = this.createShotBeam(origin, target, material);

    object.name = `replay_shot_${track.entityHex}_${event.time.toFixed(3)}`;
    object.renderOrder = 950;
    object.visible = false;

    return {
      event,
      object,
      material,
    };
  }

  private createShotBeam(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    material: THREE.MeshBasicMaterial,
  ): THREE.Mesh {
    const direction = target.clone().sub(origin);
    const length = direction.length();
    const geometry = new THREE.CylinderGeometry(
      SHOT_LINE_RADIUS,
      SHOT_LINE_RADIUS,
      Math.max(length, 0.001),
      10,
      1,
      true,
    );
    const mesh = new THREE.Mesh(geometry, material);
    const midpoint = origin.clone().add(target).multiplyScalar(0.5);

    mesh.position.copy(midpoint);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );

    return mesh;
  }

  private updateShotLines(time: number): void {
    for (const entry of this.shotLineEntries) {
      const age = time - entry.event.time;
      const isVisible = age >= 0 && age <= SHOT_LINE_LIFETIME_SECONDS;

      entry.object.visible = isVisible;

      if (!isVisible) {
        entry.material.opacity = 0;
        continue;
      }

      entry.material.opacity = 0.92 * (1 - age / SHOT_LINE_LIFETIME_SECONDS);
    }
  }

  private getShotOrigin(event: ParsedReplayShotEvent): THREE.Vector3 | null {
    if (!this.hasFiniteVector(event.originX, event.originY, event.originZ)) {
      return null;
    }

    return mapReplayPositionToThree(
      event.originX!,
      event.originY!,
      event.originZ!,
      this.calibration,
    );
  }

  private getShotTarget(
    event: ParsedReplayShotEvent,
    timeline: ReplayTimeline,
  ): THREE.Vector3 | null {
    if (event.projectileId === null || event.projectileId === undefined) {
      return null;
    }

    const points = timeline.projectilePointsByProjectileId.get(event.projectileId) ?? [];
    const candidates = points.filter((point) => {
      return point.time >= event.time && point.time <= event.time + SHOT_LINE_LIFETIME_SECONDS;
    });
    const targetPoint = candidates[candidates.length - 1];

    if (!targetPoint) {
      return null;
    }

    return mapReplayPositionToThree(
      targetPoint.x,
      targetPoint.y,
      targetPoint.z,
      this.calibration,
    );
  }

  private getShotFallbackTarget(
    event: ParsedReplayShotEvent,
    origin: THREE.Vector3,
  ): THREE.Vector3 | null {
    if (!this.hasFiniteVector(event.directionX, event.directionY, event.directionZ)) {
      return null;
    }

    // Transform a unit displacement independently: origin may be reconstructed from the tank pose.
    const displacement = shotRayEnd({ x: 0, y: 0, z: 0 },
      { x: event.directionX!, y: event.directionY!, z: event.directionZ! }, SHOT_LINE_LENGTH);
    if (!displacement) return null;
    const target = mapReplayPositionToThree(
      displacement.x,
      displacement.y,
      displacement.z,
      this.calibration,
    ).add(origin);

    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
      return null;
    }

    if (target.distanceToSquared(origin) < 1) {
      return null;
    }

    return target;
  }

  private hasFiniteVector(
    x: number | null | undefined,
    y: number | null | undefined,
    z: number | null | undefined,
  ): boolean {
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
  }

  private createConsumableSprites(): THREE.Sprite[] {
    const result: THREE.Sprite[] = [];

    for (let i = 0; i < MAX_VISIBLE_CONSUMABLE_INDICATORS; i++) {
      const material = new THREE.SpriteMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);

      sprite.name = `replay_consumable_indicator_${i}`;
      sprite.position.set((i - 1.5) * 2.75, 13.8, 0.12);
      sprite.scale.set(2.35, 2.35, 1);
      sprite.renderOrder = 1100;
      sprite.visible = false;

      result.push(sprite);
    }

    return result;
  }

  private createActiveEffectGlowSprite(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: this.createGlowTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);

    sprite.name = 'replay_active_effect_glow';
    sprite.position.set(0, 7.2, 0.04);
    sprite.scale.set(9.2, 9.2, 1);
    sprite.renderOrder = 1050;
    sprite.visible = false;

    return sprite;
  }

  private createGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Не удалось создать canvas context для replay active effect glow.');
    }

    const gradient = context.createRadialGradient(48, 48, 7, 48, 48, 47);

    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.42)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    return texture;
  }

  private updateConsumableIndicators(
    entry: ReplayTankEntry,
    time: number,
    isDimmed: boolean,
  ): void {
    const state = this.getVehicleState(entry.track.entityId, time);
    const activeExtras = state?.isAlive ? state.extras.filter(extra => extra.isConsumable
      && extra.state === 'Activated' && (extra.stateEndTime == null || time < extra.stateEndTime)) : [];
    const events = this.timeline?.consumableActivationsByEntityId.get(entry.track.entityId) ?? [];
    const activeEvents = events
      .filter((event) => {
        const age = time - event.time;

        return event.evidence === 'activationPacket'
          && event.activationTimeIsExact === true
          && (event.activeUntil == null || event.activeUntil <= event.time)
          && !this.isTrackDead(entry.track, time)
          && age >= 0
          && age <= CONSUMABLE_INDICATOR_LIFETIME_SECONDS;
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX_VISIBLE_CONSUMABLE_INDICATORS);

    for (let i = 0; i < entry.consumableSprites.length; i++) {
      const sprite = entry.consumableSprites[i];
      const event = [...activeExtras, ...activeEvents.filter(event => !activeExtras.some(extra => extra.extraId === event.extraId))][i];
      const material = sprite.material as THREE.SpriteMaterial;

      if (!event) {
        sprite.visible = false;
        material.opacity = 0;
        continue;
      }

      const age = time - event.time;
      const fade = activeExtras.some(extra => extra.extraId === event.extraId) ? 1 : 1 - age / CONSUMABLE_INDICATOR_LIFETIME_SECONDS;

      material.color.set(this.getConsumableColor(event));
      material.opacity = Math.max(0.28, fade) * (isDimmed ? 0.42 : 1);
      material.needsUpdate = true;
      sprite.visible = true;
    }
  }

  private updateActiveEffectGlow(
    entry: ReplayTankEntry,
    time: number,
    isDimmed: boolean,
  ): void {
    const activeEvent = this.findActiveLongRunningConsumable(entry.track.entityId, time);
    const material = entry.activeEffectGlow.material as THREE.SpriteMaterial;

    if (!activeEvent) {
      entry.activeEffectGlow.visible = false;
      material.opacity = 0;
      return;
    }

    material.color.set(this.getConsumableColor(activeEvent));
    material.opacity = (0.58 + Math.sin(time * 8) * 0.1) * (isDimmed ? 0.36 : 1);
    material.needsUpdate = true;
    entry.activeEffectGlow.visible = true;
  }

  private findActiveLongRunningConsumable(entityId: number, time: number): { extraId: number } | null {
    const state = this.getVehicleState(entityId, time);
    if (!state?.isAlive) return null;
    return state.extras.find(extra => extra.isConsumable && extra.state === 'Activated'
      && (extra.stateEndTime == null || time < extra.stateEndTime)) ?? null;
  }

  private getConsumableColor(event: { extraId: number }): string {
    switch (event.extraId) {
      case 9:
        return '#22c55e';
      case 10:
        return '#ef4444';
      case 61:
        return '#7f1d1d';
      case 11:
        return '#f97316';
      case 13:
        return '#9a3412';
      default:
        return '#22c55e';
    }
  }

  private getVisibilityState(
    track: ReplayMovementTrack,
    time: number,
  ): ReplayVisibilityState {
    const intervals = this.timeline?.visibilityIntervalsByEntityId.get(track.entityId) ?? [];

    const state = this.getVehicleState(track.entityId, time);
    return {
      hasVisibilityData: true,
      isVisible: state?.isVisible ?? false,
      hasBeenVisible: (this.timeline?.statesByEntityId.get(track.entityId) ?? [])
        .some(frame => frame.time <= time && frame.isVisible),
      lastVisibleTime: findLastVisibleTime(intervals, time),
      intervals,
    };
  }

  private setTankVisualAppearance(
    visual: TankVisual,
    color: string,
    dimmed: boolean,
  ): void {
    const meshOpacity = dimmed ? INVISIBLE_TANK_OPACITY : 1;
    const labelOpacity = dimmed ? INVISIBLE_LABEL_OPACITY : 1;

    visual.root.traverse((object) => {
      if (object === visual.selectionRing) return;
      if (object instanceof THREE.Sprite) {
        if (object.name === 'manual_tank_label') {
          this.setMaterialOpacity(object.material, labelOpacity);
        }

        return;
      }

      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
        const material = object.material;

        if (Array.isArray(material)) {
          for (const item of material) {
            this.setColoredMaterialAppearance(item, color, meshOpacity);
          }
        } else {
          this.setColoredMaterialAppearance(material, color, meshOpacity);
        }
      }
    });
  }

  private setColoredMaterialAppearance(
    material: THREE.Material,
    color: string,
    opacity: number,
  ): void {
    if ('color' in material && material.color instanceof THREE.Color) {
      material.color.set(color);
    }

    this.setMaterialOpacity(material, opacity);
  }

  private setMaterialOpacity(
    material: THREE.Material,
    opacity: number,
  ): void {
    // Sprite textures contain transparent corners even at full object opacity.
    // Keep them in the transparent pass, after replay paths and shot beams.
    const texturedSprite = material instanceof THREE.SpriteMaterial && material.map !== null;
    const transparent = texturedSprite || opacity < 0.999;
    material.transparent = transparent;
    material.opacity = opacity;
    material.depthWrite = !transparent;
    material.needsUpdate = true;
  }

  private setTrackAppearance(
    group: THREE.Group,
    color: string,
    opacity: number,
  ): void {
    const gradient = this.selectedEntityId !== null && group.userData.replayEntityId === this.selectedEntityId;
    if (this.selectedEntityId !== null) {
      if (gradient) { color = '#ffffff'; opacity = Math.max(opacity, 0.95); }
      else opacity *= 0.25;
    }
    group.traverse((object) => {
      if (!(object instanceof Line2 || object instanceof THREE.Line || object instanceof THREE.LineSegments)) {
        return;
      }

      const material = object.material;
      if (object instanceof Line2) object.material.linewidth = gradient ? 5 : 1;
      const materials = Array.isArray(material) ? material : [material];
      for (const item of materials) {
        if (item.vertexColors !== gradient) { item.vertexColors = gradient; item.needsUpdate = true; }
      }

      if (Array.isArray(material)) {
        for (const item of material) {
          this.setColoredMaterialAppearance(item, color, opacity);
        }
      } else {
        this.setColoredMaterialAppearance(material, color, opacity);
      }
    });
  }

  private calculateBodyYawDegrees(yawRadians: number): number {
    return this.calculateTransformedYawDegrees(yawRadians);
  }

  private calculateTurretYawDegrees(
    bodyYawRadians: number,
    turretYawRadians: number,
  ): number {
    const transformedBodyYaw = this.calculateTransformedYawDegrees(bodyYawRadians);
    const transformedTurretYaw = this.calculateTransformedYawDegrees(
      bodyYawRadians + turretYawRadians,
    );

    return this.normalizeDegrees(transformedTurretYaw - transformedBodyYaw + 180);
  }

  private calculateTransformedYawDegrees(yawRadians: number): number {
    const from = mapReplayPositionToThree(0, 0, 0, this.calibration);
    const to = mapReplayPositionToThree(
      Math.sin(yawRadians),
      0,
      Math.cos(yawRadians),
      this.calibration,
    );

    const deltaX = to.x - from.x;
    const deltaZ = to.z - from.z;

    return THREE.MathUtils.radToDeg(Math.atan2(deltaX, deltaZ));
  }

  private normalizeDegrees(degrees: number): number {
    let normalized = degrees;

    while (normalized > 180) {
      normalized -= 360;
    }

    while (normalized < -180) {
      normalized += 360;
    }

    return normalized;
  }

  private createTankLabel(
    track: ReplayMovementTrack,
    displayedHealth: number | null,
  ): string {
    const name = track.nickname || track.entityHex;

    return displayedHealth === null
      ? `${name}\nHP ?`
      : `${name}\nHP ${Math.round(displayedHealth)}`;
  }

  private isTrackDead(
    track: ReplayMovementTrack,
    time: number,
  ): boolean {
    const deathTime = this.getTrackDeathTime(track);

    return deathTime !== null && time >= deathTime;
  }

  private getTrackDeathTime(track: ReplayMovementTrack): number | null {
    return this.timeline?.statesByEntityId.get(track.entityId)?.find(state => !state.isAlive)?.time ?? null;
  }

  private getTrackVisualColor(
    track: ReplayMovementTrack,
    dimmed: boolean,
  ): string {
    const vehicleClass = this.timeline?.presentation.vehicles.find(vehicle => vehicle.entityId === track.entityId)?.vehicleClass;
    return replayTankColor(getReplayTeamKind(track.teamId, this.timeline?.recorderTeamId ?? null), vehicleClass ?? undefined, dimmed);
  }

  private getDisplayedHealth(
    track: ReplayMovementTrack,
    time: number,
  ): number | null {
    return this.getVehicleState(track.entityId, time)?.health ?? null;
  }

  private getVehicleState(entityId: number, time: number) {
    return findLatestByTime(this.timeline?.statesByEntityId.get(entityId) ?? [], time);
  }

  private isEnemyTrack(track: ReplayMovementTrack): boolean {
    return getReplayTeamKind(track.teamId, this.timeline?.recorderTeamId ?? null) === 'enemy';
  }

  private getReplayTankVerticalOffset(): number {
    // TODO: Временное MVP-решение.
    // Сейчас replay-танк слегка поднимается над terrain frontend-константой.
    // Потом добавить replayTransform.heightOffset в MapCalibration DTO/backend/frontend.
    // Убрать эту константу из ReplayLayer, когда heightOffset станет частью map_calibration.json.
    return 0.35;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      this.disposeObject(child);
    }
  }

  private disposeMaterial(material: THREE.Material): void {
    if (material instanceof THREE.SpriteMaterial && material.map) {
      material.map.dispose();
    }

    material.dispose();
  }

  private disposeObject(object: THREE.Object3D): void {
    for (const child of object.children) {
      this.disposeObject(child);
    }

    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.LineSegments ||
      object instanceof THREE.Sprite
    ) {
      if ('geometry' in object && object.geometry) {
        object.geometry.dispose();
      }

      if (Array.isArray(object.material)) {
        for (const material of object.material) {
          this.disposeMaterial(material);
        }
      } else {
        this.disposeMaterial(object.material);
      }
    }
  }
}
