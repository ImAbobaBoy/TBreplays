export type ReplayVehicleInfo = {
  entityId: number;
  accountId: number | string;
  nickname: string;
  teamId: number;
  vehicleCompactDescriptor: number;
  vehicleKey?: string | null;
  vehicleName?: string | null;
  nation?: string | null;
  level?: number | null;
  baseHullHp?: number | null;
  initialHealth?: number | null;
  initialHealthTime?: number | null;
  maxObservedHealth?: number | null;
  effectiveHp?: number | null;
  resultCurrentHp?: number | null;
  resultDamageReceived?: number | null;
  resultDestroyed?: boolean | null;
  effectiveHpSource?: string | null;
  effectiveHpDeltaFromBase?: number | null;
  effectiveHpRatioToBase?: number | null;
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

export type ParsedReplayVisibilityFrame = {
  time: number;
  entityId: number;
  isVisible: boolean;
};

export type ParsedReplayVisibilityInterval = {
  entityId: number;
  startTime: number;
  endTime?: number | null;
  isOpenEnded: boolean;
};

export type ParsedReplayShotEvent = {
  time: number;
  shooterEntityId: number;
  projectileId?: number | null;
  shotFlags?: number | null;
  originX?: number | null;
  originY?: number | null;
  originZ?: number | null;
  directionX?: number | null;
  directionY?: number | null;
  directionZ?: number | null;
};

export type ParsedReplayProjectilePoint = {
  time: number;
  projectileId: number;
  x: number;
  y: number;
  z: number;
};


export type ReplayDamageEvent = {
  time: number;
  targetEntityId: number;
  previousHealth: number;
  newHealth: number;
  damage: number;
  attackerEntityId?: number | null;
  source: string;
};

export type ReplayDeathEvent = {
  time: number;
  entityId: number;
  previousHealth: number;
  source: string;
};

export type ReplayExtraStateFrame = {
  duration?: number;
  stateEndTime?: number | null;
  time: number;
  entityId: number;
  extraId: number;
  key: string;
  name: string;
  category: string;
  sourceKind: string;
  stateCode: number;
  state: string;
  isConsumable: boolean;
  isTimelineActivation: boolean;
  confidence: string;
};

export type ReplayConsumableActivationEvent = {
  activationTime?: number | null;
  activationTimeIsExact?: boolean;
  evidence?: string;
  activeUntil?: number | null;
  time: number;
  entityId: number;
  extraId: number;
  key: string;
  name: string;
  state: string;
  confidence: string;
  repairedModules?: unknown[];
};

export type ReplayMapBinding = {
  replayMapName?: string | null;
  replayMapId?: number | null;
  normalizedReplayMapName?: string | null;
  matchStatus?: string | null;
  matchedBackendMapId?: string | null;
  matchedMapKey?: string | null;
  matchedMapReplayName?: string | null;
};

export type ReplayTimelineDiagnosticSummary = {
  startTime?: number | null;
  endTime?: number | null;
  battleDuration?: number | null;
  vehicleCount?: number;
  movementFrameCount?: number;
  turretFrameCount?: number;
  shotEventCount?: number;
  projectilePointCount?: number;
  healthFrameCount?: number;
  visibilityFrameCount?: number;
  visibilityIntervalCount?: number;
  damageEventCount?: number;
  deathEventCount?: number;
  consumableActivationEventCount?: number;
  warningCount?: number;
  hasMovement?: boolean;
  hasVisibility?: boolean;
  hasDamage?: boolean;
};

export type ReplayParseResult = {
  clientVersion?: string | null;
  clientHash?: string | null;
  mapName?: string | null;
  mapId?: number | null;
  battleDuration?: number | null;
  mapBinding?: ReplayMapBinding | null;
  timelineSummary?: ReplayTimelineDiagnosticSummary | null;
  vehicles: ReplayVehicleInfo[];
  movementFrames: ParsedReplayMovementFrame[];
  turretFrames: ParsedReplayTurretFrame[];
  shotEvents: ParsedReplayShotEvent[];
  projectilePoints: ParsedReplayProjectilePoint[];
  healthFrames: ParsedReplayHealthFrame[];
  damageEvents?: ReplayDamageEvent[];
  deathEvents?: ReplayDeathEvent[];
  visibilityFrames?: ParsedReplayVisibilityFrame[];
  visibilityIntervals?: ParsedReplayVisibilityInterval[];
  extraStateFrames?: ReplayExtraStateFrame[];
  consumableActivationEvents?: ReplayConsumableActivationEvent[];
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
  visibilityFrameCount?: number;
  visibilityIntervalCount?: number;
  consumableActivationEventCount?: number;
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
  vehicle: ReplayVehicleInfo;
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
  presentation: ReplayPresentation;
  recorderTeamId: number | null;
  statesByEntityId: Map<number, ReplayVehicleState[]>;
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
  visibilityIntervalsByEntityId: Map<number, ParsedReplayVisibilityInterval[]>;
  consumableActivationsByEntityId: Map<number, ReplayConsumableActivationEvent[]>;
  shotEvents: ParsedReplayShotEvent[];
  projectilePointsByProjectileId: Map<number, ParsedReplayProjectilePoint[]>;
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

export type ReplayTeamHealthSideState = ReplayTeamState & { label: string };
export type ReplayTeamHealthState = {
  time: number;
  ally: ReplayTeamHealthSideState | null;
  enemy: ReplayTeamHealthSideState | null;
  presentation: ReplayPresentation;
  states: Map<number, ReplayVehicleState>;
  resultVisible: boolean;
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

export type ReplayImportItemResult = {
  fileName: string;
  success: boolean;
  error?: string | null;
  replayId?: string | null;
  title: string;
  sourceFileName?: string | null;
  mapName?: string | null;
  battleDuration?: number | null;
  importedAtUtc: string;
  vehicleCount: number;
  movementFrameCount: number;
  turretFrameCount: number;
  shotEventCount: number;
  projectilePointCount: number;
  healthFrameCount: number;
  visibilityFrameCount?: number;
  visibilityIntervalCount?: number;
  damageEventCount?: number;
  deathEventCount?: number;
  consumableActivationEventCount?: number;
  parseResultUrl?: string | null;
};

export type ReplayImportBatchResult = {
  items: ReplayImportItemResult[];
};

export type ReplaySessionItem = {
  replayId: string;
  title: string;
  sourceFileName?: string | null;
  mapName?: string | null;
  battleDuration?: number | null;
  importedAtUtc: string;
  parseResultUrl: string;
};

export type ReplayVehicleState = {
  time: number; health: number | null; healthFraction: number | null;
  isAlive: boolean; isVisible: boolean; healthIsLastKnown: boolean;
  observedDamageReceived: number; confirmedKills: number; extras: ReplayExtraStateFrame[];
};
export type ReplayTeamState = {
  teamId: number; aliveCount: number; confirmedKills: number;
  initialHp: number | null; lastKnownHp: number | null;
  hasUnobservedHealth: boolean; supremacyPoints: number | null;
};
export type ReplayPresentation = {
  schemaVersion: number; recorderTeamId: number | null; recorderEntityId: number | null;
  mapName: string | null; mapId: number | null;
  outcome: { winnerTeamId: number | null; reason: string; reasonName: string;
    status: string; endTime: number | null; sourcesAgree: boolean };
  vehicles: (ReplayVehicleInfo & { initialHp: number | null; finalHp: number | null;
    damageDealt: number | null; damageReceived: number | null; confirmedKills: number;
    vehicleClass: string | null; extras: { extraId: number; name: string; kind: string;
      minimumUses: number; directUses: number; inferredUses: number; usageMayBeIncomplete: boolean }[] })[];
  playback: {
    timeBasis: string; startTime: number; endTime: number;
    vehicles: { entityId: number; teamId: number; movement: ParsedReplayMovementFrame[];
      turret: ParsedReplayTurretFrame[]; states: ReplayVehicleState[];
      visibility: ParsedReplayVisibilityInterval[]; consumableUses: ReplayConsumableActivationEvent[];
      shots: ParsedReplayShotEvent[] }[];
    scoreboard: { time: number; teams: ReplayTeamState[] }[];
    projectiles: { projectileId: number; points: ParsedReplayProjectilePoint[] }[];
  };
};
