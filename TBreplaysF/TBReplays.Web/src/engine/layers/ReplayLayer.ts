import * as THREE from 'three';

import type { MapCalibration } from '../../domain/MapCalibration';
import type {
  ParsedReplayHealthFrame,
  ReplayMovementTrack,
  ReplayPose,
  ReplayTimeline,
} from '../../domain/ReplayModels';
import type { ManualTankModel } from '../../domain/TankModels';
import { mapReplayPositionToThree } from '../MapCalibrationTransforms';
import {
  findLatestByTime,
  sampleTrackAtTime,
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
  lastRenderedLabel: string | null;
};

export class ReplayLayer {
  private readonly root: THREE.Group;
  private readonly tracksRoot = new THREE.Group();
  private readonly tanksRoot = new THREE.Group();
  private readonly tankEntries = new Map<number, ReplayTankEntry>();

  private timeline: ReplayTimeline | null = null;
  private calibration: MapCalibration | null = null;
  private currentTime = 0;

  public constructor(root: THREE.Group) {
    this.root = root;

    this.tracksRoot.name = 'replay_tracks_root';
    this.tanksRoot.name = 'replay_tanks_root';

    this.root.add(this.tracksRoot);
    this.root.add(this.tanksRoot);
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
      const color = this.getTeamColor(track.teamId, i);

      this.tracksRoot.add(this.createMovementPath(track, color));

      const visual = createTankVisual(this.createTankModel(
        track,
        color,
        null,
        timeline.minTime,
      ));

      this.tanksRoot.add(visual.root);

      this.tankEntries.set(track.entityId, {
        track,
        visual,
        lastRenderedLabel: null,
      });
    }

    this.setTime(timeline.minTime);
  }

  public setCalibration(calibration: MapCalibration | null): void {
    this.calibration = calibration;

    if (!this.timeline) {
      return;
    }

    // TODO: Временное MVP-решение.
    // Сейчас при изменении map_calibration.json пересоздаём replay layer целиком,
    // чтобы траектории и танки пересчитались по новой системе координат.
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
  }

  public clear(): void {
    this.timeline = null;
    this.currentTime = 0;

    for (const entry of this.tankEntries.values()) {
      this.tanksRoot.remove(entry.visual.root);
      disposeTankVisual(entry.visual);
    }

    this.tankEntries.clear();
    this.clearGroup(this.tracksRoot);
  }

  public dispose(): void {
    this.clear();
  }

  private updateTankAtTime(
    entry: ReplayTankEntry,
    time: number,
  ): void {
    const pose = sampleTrackAtTime(entry.track, time);

    if (!pose) {
      entry.visual.root.visible = false;
      return;
    }

    entry.visual.root.visible = true;

    const healthFrame = this.timeline
      ? findLatestByTime(
        this.timeline.healthFramesByEntityId.get(entry.track.entityId) ?? [],
        time,
      )
      : null;

    const model = this.createTankModel(
      entry.track,
      this.getTeamColor(entry.track.teamId, 0),
      healthFrame,
      time,
      pose,
    );

    const turretFrame = this.timeline
      ? findLatestByTime(
        this.timeline.turretFramesByEntityId.get(entry.track.entityId) ?? [],
        time,
      )
      : null;

    if (turretFrame) {
      model.pose.turretYawDegrees = this.calculateTurretYawDegrees(
        pose.yawRadians,
        turretFrame.turretYawRadians,
      );
    }

    applyTankModelToVisual(model, entry.visual);
    entry.lastRenderedLabel = model.label;
  }

  private createTankModel(
    track: ReplayMovementTrack,
    color: string,
    healthFrame: ParsedReplayHealthFrame | null,
    time: number,
    pose?: ReplayPose,
  ): ManualTankModel {
    const actualPose = pose ?? sampleTrackAtTime(track, time);
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

    return {
      id: `replay-${track.entityId}`,
      coordinateSpace: 'viewer-world-v1',
      label: this.createTankLabel(track, healthFrame),
      visualKey: 'medium',
      team: track.teamId === 1 ? 'ally' : 'enemy',
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
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `replay_track_${track.entityHex}`;

    const samplesBySegment = new Map<number, typeof track.samples>();

    for (const sample of track.samples) {
      let segment = samplesBySegment.get(sample.segmentIndex);

      if (!segment) {
        segment = [];
        samplesBySegment.set(sample.segmentIndex, segment);
      }

      segment.push(sample);
    }

    for (const [segmentIndex, segmentSamples] of samplesBySegment) {
      if (segmentSamples.length < 2) {
        continue;
      }

      const pathStep = Math.max(1, Math.floor(segmentSamples.length / 300));
      const pathSamples = segmentSamples.filter((_, index) => index % pathStep === 0);
      const positions = new Float32Array(pathSamples.length * 3);

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
      }

      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3),
      );

      geometry.computeBoundingSphere();

      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.72,
      });

      const line = new THREE.Line(geometry, material);
      line.name = `replay_track_${track.entityHex}_segment_${segmentIndex}`;

      group.add(line);
    }

    return group;
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

    return this.normalizeDegrees(transformedTurretYaw - transformedBodyYaw);
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
    healthFrame: ParsedReplayHealthFrame | null,
  ): string {
    const name = track.nickname || track.entityHex;

    if (!healthFrame) {
      return `${name}\nHP ?`;
    }

    return `${name}\nHP ${healthFrame.health}`;
  }

  private getTeamColor(
    teamId: number,
    index: number,
  ): string {
    if (teamId === 1) {
      return '#38bdf8';
    }

    if (teamId === 2) {
      return '#fb7185';
    }

    const fallbackColors = [
      '#facc15',
      '#22c55e',
      '#a855f7',
      '#ffffff',
    ];

    return fallbackColors[index % fallbackColors.length];
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
  }
}