export type ReplayVehicleInfo = {
  entityId: number;
  accountId: number;
  nickname: string;
  teamId: number;
  vehicleCompactDescriptor: number;
};

export type ParsedReplayMovementFrame = {
  time: number;
  entityId: number;
  teamId: number;
  segmentIndex: number;
  x: number;
  y: number;
  z: number;
  yawRadians: number;
  pitchRadians: number;
  rollRadians: number;
  isVolatile: boolean;
};

export type ParsedReplayTurretFrame = {
  time: number;
  entityId: number;
  turretYawRadians: number;
};

export type ParsedReplayHealthFrame = {
  time: number;
  entityId: number;
  health: number;
};

export type ReplayParseResult = {
  mapName?: string | null;
  mapId?: number | null;
  battleDuration?: number | null;
  vehicles: ReplayVehicleInfo[];
  movementFrames: ParsedReplayMovementFrame[];
  turretFrames: ParsedReplayTurretFrame[];
  shotEvents: unknown[];
  projectilePoints: unknown[];
  healthFrames: ParsedReplayHealthFrame[];
};

export type ReplayParseLocalResult = {
  replayId: string;
  mapName?: string | null;
  mapId?: number | null;
  vehicleCount: number;
  movementFrameCount: number;
  turretFrameCount: number;
  shotEventCount: number;
  projectilePointCount: number;
  healthFrameCount: number;
  parseResultUrl: string;
};

export type ReplayMovementSample = {
  time: number;
  segmentIndex: number;
  x: number;
  y: number;
  z: number;
  yawRadians: number;
};

export type ReplayMovementTrack = {
  entityId: number;
  entityHex: string;
  teamId: number;
  nickname: string;
  vehicleCompactDescriptor: number;
  firstTime: number;
  lastTime: number;
  samples: ReplayMovementSample[];
};

export type ReplayPose = {
  x: number;
  y: number;
  z: number;
  yawRadians: number;
};

export type ReplayTimeline = {
  replayId: string;
  mapName: string | null;
  mapId: number | null;
  battleDuration: number | null;
  minTime: number;
  maxTime: number;
  trackCount: number;
  sampleCount: number;
  tracks: ReplayMovementTrack[];
  turretFramesByEntityId: Map<number, ParsedReplayTurretFrame[]>;
  healthFramesByEntityId: Map<number, ParsedReplayHealthFrame[]>;
};

export type ReplayTimelineSummary = {
  replayId: string;
  mapName: string | null;
  mapId: number | null;
  minTime: number;
  maxTime: number;
  trackCount: number;
  sampleCount: number;
};

export type ReplayPlaybackState = {
  replayId: string | null;
  time: number;
  minTime: number;
  maxTime: number;
  isPlaying: boolean;
  speed: number;
  revision: number;
};

export type ReplayRoomCommand =
  | {
      kind: 'loadReplay';
      replayId: string;
      mapId: string | null;
      revision: number;
      serverIssuedAtUnixMs: number;
    }
  | {
      kind: 'seek';
      replayId: string;
      time: number;
      revision: number;
      serverIssuedAtUnixMs: number;
    }
  | {
      kind: 'play';
      replayId: string;
      time: number;
      speed: number;
      revision: number;
      serverIssuedAtUnixMs: number;
    }
  | {
      kind: 'pause';
      replayId: string;
      time: number;
      revision: number;
      serverIssuedAtUnixMs: number;
    }
  | {
      kind: 'changeSpeed';
      replayId: string;
      time: number;
      speed: number;
      revision: number;
      serverIssuedAtUnixMs: number;
    };