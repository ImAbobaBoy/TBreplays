import type { ParsedReplayVisibilityInterval, ReplayMovementSample, ReplayMovementTrack,
  ReplayPose, ReplayTimeline, ReplayPresentation, ReplayTeamHealthState } from '../../domain/ReplayModels';

export function buildReplayTimeline(replayId: string, data: ReplayPresentation): ReplayTimeline {
  const vehicles = new Map(data.vehicles.map(vehicle => [vehicle.entityId, vehicle]));
  const tracks: ReplayMovementTrack[] = data.playback.vehicles.flatMap(track => {
    const vehicle = vehicles.get(track.entityId);
    if (!vehicle) throw new Error(`Нет данных танка ${track.entityId} в presentation.`);
    return [{ entityId: track.entityId, entityHex: `0x${track.entityId.toString(16)}`,
      teamId: track.teamId, nickname: vehicle.nickname, vehicleCompactDescriptor: vehicle.vehicleCompactDescriptor,
      vehicle, samples: track.movement, firstTime: track.movement[0]?.time ?? data.playback.startTime,
      lastTime: track.movement.at(-1)?.time ?? data.playback.startTime }];
  });
  return {
    replayId, presentation: data,
    recorderTeamId: data.recorderTeamId ?? vehicles.get(data.recorderEntityId ?? -1)?.teamId ?? null,
    mapName: data.mapName, mapId: data.mapId, battleDuration: data.playback.endTime - data.playback.startTime,
    minTime: data.playback.startTime, maxTime: data.playback.endTime,
    tracks, trackCount: tracks.length, sampleCount: tracks.reduce((n, t) => n + t.samples.length, 0),
    statesByEntityId: new Map(data.playback.vehicles.map(t => [t.entityId, t.states])),
    turretFramesByEntityId: new Map(data.playback.vehicles.map(t => [t.entityId, t.turret])),
    visibilityIntervalsByEntityId: new Map(data.playback.vehicles.map(t => [t.entityId, t.visibility])),
    consumableActivationsByEntityId: new Map(data.playback.vehicles.map(t => [t.entityId, t.consumableUses])),
    shotEvents: data.playback.vehicles.flatMap(t => t.shots).sort((a,b) => a.time-b.time),
    projectilePointsByProjectileId: new Map(data.playback.projectiles.map(p => [p.projectileId, p.points])),
  };
}

export function getReplayTeamKind(teamId: number, recorderTeamId: number | null): 'ally' | 'enemy' | 'neutral' {
  return recorderTeamId === null ? 'neutral' : teamId === recorderTeamId ? 'ally' : 'enemy';
}

export function selectReplayHud(timeline: ReplayTimeline, time: number): ReplayTeamHealthState {
  const frame = findLatestByTime(timeline.presentation.playback.scoreboard, time);
  const ally = frame?.teams.find(t => t.teamId === timeline.recorderTeamId);
  const enemy = timeline.recorderTeamId === null ? null : frame?.teams.find(t => t.teamId !== timeline.recorderTeamId);
  return { time, ally: ally ? { ...ally, label: 'Команда автора' } : null,
    enemy: enemy ? { ...enemy, label: 'Противники' } : null, presentation: timeline.presentation,
    states: new Map([...timeline.statesByEntityId].flatMap(([id, frames]) => {
      const state = findLatestByTime(frames, time); return state ? [[id, state] as const] : [];
    })), resultVisible: time >= (timeline.presentation.outcome.endTime ?? timeline.maxTime) };
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

  const pair = findSurroundingSamples(track, time);

  if (!pair) {
    return null;
  }

  const [a, b] = pair;

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

export function sampleTrackLatestAtTime(
  track: ReplayMovementTrack,
  time: number,
): ReplayPose | null {
  const sample = findLatestSampleAtTime(track, time);

  return sample ? sampleToPose(sample) : null;
}

export function findLatestSampleAtTime(
  track: ReplayMovementTrack,
  time: number,
): ReplayMovementSample | null {
  if (track.samples.length === 0 || time < track.samples[0].time) {
    return null;
  }

  let left = 0;
  let right = track.samples.length - 1;

  while (left < right) {
    const middle = Math.ceil((left + right) / 2);

    if (track.samples[middle].time <= time) {
      left = middle;
    } else {
      right = middle - 1;
    }
  }

  return track.samples[left];
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

export function isVisibleByIntervals(
  intervals: ParsedReplayVisibilityInterval[],
  time: number,
): boolean {
  if (intervals.length === 0) {
    return true;
  }

  return intervals.some((interval) => {
    const endTime = interval.endTime ?? Number.POSITIVE_INFINITY;

    return time >= interval.startTime && time <= endTime;
  });
}

export function findLastVisibleTime(
  intervals: ParsedReplayVisibilityInterval[],
  time: number,
): number | null {
  let lastVisibleTime: number | null = null;

  for (const interval of intervals) {
    if (time < interval.startTime) {
      continue;
    }

    const endTime = interval.endTime ?? time;

    if (time <= endTime) {
      return time;
    }

    lastVisibleTime = Math.max(lastVisibleTime ?? endTime, endTime);
  }

  return lastVisibleTime;
}

export function findLastVisibleSampleTime(
  track: ReplayMovementTrack,
  intervals: ParsedReplayVisibilityInterval[],
  time: number,
): number | null {
  if (track.samples.length === 0 || intervals.length === 0) {
    return null;
  }

  let result: number | null = null;

  for (const sample of track.samples) {
    if (sample.time > time) {
      break;
    }

    if (isVisibleByIntervals(intervals, sample.time)) {
      result = sample.time;
    }
  }

  return result;
}

export function splitSamplesByVisibilityIntervals(
  track: ReplayMovementTrack,
  intervals: ParsedReplayVisibilityInterval[],
): ReplayMovementSample[][] {
  if (intervals.length === 0) {
    return [track.samples];
  }

  const result: ReplayMovementSample[][] = [];

  for (const interval of intervals) {
    const endTime = interval.endTime ?? Number.POSITIVE_INFINITY;
    const samples = track.samples.filter((sample) => {
      return sample.time >= interval.startTime && sample.time <= endTime;
    });

    if (samples.length >= 2) {
      result.push(samples);
    }
  }

  return result;
}

export function hasBeenVisibleByTime(
  intervals: ParsedReplayVisibilityInterval[],
  time: number,
): boolean {
  if (intervals.length === 0) {
    return true;
  }

  return intervals.some((interval) => interval.startTime <= time);
}

function findSurroundingSamples(
  track: ReplayMovementTrack,
  time: number,
): [ReplayMovementSample, ReplayMovementSample] | null {
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

  return [track.samples[left], track.samples[right]];
}

function sampleToPose(sample: ReplayMovementSample): ReplayPose {
  return {
    x: sample.x,
    y: sample.y,
    z: sample.z,
    yawRadians: sample.yawRadians,
  };
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
