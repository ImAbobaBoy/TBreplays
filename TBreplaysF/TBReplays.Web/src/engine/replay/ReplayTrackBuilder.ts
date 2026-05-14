import type {
  ParsedReplayHealthFrame,
  ParsedReplayMovementFrame,
  ParsedReplayTurretFrame,
  ReplayMovementSample,
  ReplayMovementTrack,
  ReplayParseResult,
  ReplayPose,
  ReplayTimeline,
  ReplayVehicleInfo,
} from '../../domain/ReplayModels';

export function buildReplayTimeline(
  replayId: string,
  parseResult: ReplayParseResult,
): ReplayTimeline {
  const vehiclesByEntityId = new Map<number, ReplayVehicleInfo>();

  for (const vehicle of parseResult.vehicles) {
    vehiclesByEntityId.set(vehicle.entityId, vehicle);
  }

  const framesByEntityId = groupByEntityId(parseResult.movementFrames);
  const tracks: ReplayMovementTrack[] = [];

  for (const [entityId, frames] of framesByEntityId) {
    const vehicle = vehiclesByEntityId.get(entityId);

    if (!vehicle) {
      continue;
    }

    const ordered = [...frames].sort(compareByTime);

    if (ordered.length === 0) {
      continue;
    }

    const samples = ordered.map(mapMovementFrameToSample);

    tracks.push({
      entityId,
      entityHex: `0x${entityId.toString(16)}`,
      teamId: vehicle.teamId,
      nickname: vehicle.nickname,
      vehicleCompactDescriptor: vehicle.vehicleCompactDescriptor,
      firstTime: samples[0].time,
      lastTime: samples[samples.length - 1].time,
      samples,
    });
  }

  tracks.sort((a, b) => a.teamId - b.teamId || a.entityId - b.entityId);

  const minTime = tracks.length > 0
    ? Math.min(...tracks.map((track) => track.firstTime))
    : 0;

  const maxTime = tracks.length > 0
    ? Math.max(...tracks.map((track) => track.lastTime))
    : 0;

  return {
    replayId,
    mapName: parseResult.mapName ?? null,
    mapId: parseResult.mapId ?? null,
    battleDuration: parseResult.battleDuration ?? null,
    minTime,
    maxTime,
    trackCount: tracks.length,
    sampleCount: tracks.reduce((sum, track) => sum + track.samples.length, 0),
    tracks,
    turretFramesByEntityId: groupByEntityId(parseResult.turretFrames),
    healthFramesByEntityId: groupByEntityId(parseResult.healthFrames),
  };
}

export function sampleTrackAtTime(
  track: ReplayMovementTrack,
  time: number,
): ReplayPose | null {
  if (track.samples.length === 0) {
    return null;
  }

  if (time < track.firstTime || time > track.lastTime) {
    return null;
  }

  if (time <= track.samples[0].time) {
    return sampleToPose(track.samples[0]);
  }

  const lastSample = track.samples[track.samples.length - 1];

  if (time >= lastSample.time) {
    return sampleToPose(lastSample);
  }

  let left = 0;
  let right = track.samples.length - 1;

  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);

    if (track.samples[middle].time <= time) {
      left = middle;
    } else {
      right = middle;
    }
  }

  const a = track.samples[left];
  const b = track.samples[right];

  if (a.segmentIndex !== b.segmentIndex) {
    return null;
  }

  const duration = b.time - a.time;

  if (duration <= 0.0001) {
    return sampleToPose(a);
  }

  const t = (time - a.time) / duration;

  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    yawRadians: lerpAngle(a.yawRadians, b.yawRadians, t),
  };
}

export function findLatestByTime<T extends { time: number }>(
  frames: T[],
  time: number,
): T | null {
  if (frames.length === 0 || time < frames[0].time) {
    return null;
  }

  let left = 0;
  let right = frames.length - 1;

  while (left < right) {
    const middle = Math.ceil((left + right) / 2);

    if (frames[middle].time <= time) {
      left = middle;
    } else {
      right = middle - 1;
    }
  }

  return frames[left];
}

function mapMovementFrameToSample(
  frame: ParsedReplayMovementFrame,
): ReplayMovementSample {
  return {
    time: frame.time,
    segmentIndex: frame.segmentIndex,
    x: frame.x,
    y: frame.y,
    z: frame.z,
    yawRadians: frame.yawRadians,
  };
}

function sampleToPose(sample: ReplayMovementSample): ReplayPose {
  return {
    x: sample.x,
    y: sample.y,
    z: sample.z,
    yawRadians: sample.yawRadians,
  };
}

function groupByEntityId<T extends ParsedReplayMovementFrame | ParsedReplayTurretFrame | ParsedReplayHealthFrame>(
  items: T[],
): Map<number, T[]> {
  const result = new Map<number, T[]>();

  for (const item of items) {
    let group = result.get(item.entityId);

    if (!group) {
      group = [];
      result.set(item.entityId, group);
    }

    group.push(item);
  }

  for (const group of result.values()) {
    group.sort(compareByTime);
  }

  return result;
}

function compareByTime<T extends { time: number }>(
  a: T,
  b: T,
): number {
  return a.time - b.time;
}

function lerp(
  a: number,
  b: number,
  t: number,
): number {
  return a + (b - a) * t;
}

function lerpAngle(
  a: number,
  b: number,
  t: number,
): number {
  let delta = b - a;

  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }

  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  return a + delta * t;
}