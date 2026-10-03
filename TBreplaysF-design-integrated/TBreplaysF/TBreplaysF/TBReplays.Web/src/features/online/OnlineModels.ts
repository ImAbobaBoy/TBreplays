import type { ManualTankModel } from '../../domain/TankModels';
import type { DrawingStrokeModel } from '../../domain/DrawingModels';
export type OnlineUser = { id: string; login: string; role: 'admin' | 'editor' | 'observer' };
export type StoredStroke = { stroke: DrawingStrokeModel; revision: number; authorId: string };
export type StoredTank = { tank: ManualTankModel; revision: number; authorId: string };
export type SketchState = { revision: number; mapId: string | null; mapRevision: number; strokes: StoredStroke[]; tanks?: StoredTank[] };
export type SketchCommand = { operationId: string; kind: 'upsert' | 'remove' | 'clear' | 'setMap' | 'upsertTank' | 'removeTank' | 'clearTanks';
  expectedRevision: number; mapRevision: number; stroke?: DrawingStrokeModel; strokeId?: string; mapId?: string; tank?: ManualTankModel; tankId?: string };
export type SketchChange = SketchCommand & { revision: number; userId: string };
export type SketchResult = { applied: boolean; error: string | null; change: SketchChange | null };
export type OnlineState = { board: SketchState | null; users: OnlineUser[];
  status: 'connecting' | 'connected' | 'reconnecting' | 'offline'; pending: boolean; message: string; replay: ReplaySyncState | null; connectionId: string | null;
  clockOffsetMs: number; replayPending: boolean; replayMessage: string };
export const roleNames = { admin: 'Администратор', editor: 'Редактор', observer: 'Наблюдатель' };
// Null means there is a gap; fetch a snapshot rather than applying incomplete history.
export function applySketchChange(state: SketchState | null, change: SketchChange): SketchState | null {
  if (!state) return null;
  if (change.revision <= state.revision) return state;
  if (change.revision !== state.revision + 1) return null;
  let strokes = state.strokes;
  if (change.kind === 'clear' || change.kind === 'setMap') strokes = [];
  if (change.kind === 'remove') strokes = strokes.filter(x => x.stroke.id !== change.strokeId);
  if (change.kind === 'upsert' && change.stroke) {
    const previous = strokes.find(x => x.stroke.id === change.stroke!.id);
    strokes = [...strokes.filter(x => x.stroke.id !== change.stroke!.id),
      { stroke: change.stroke, revision: change.revision, authorId: previous?.authorId ?? change.userId }];
  }
  let tanks = state.tanks ?? [];
  if (change.kind === 'setMap' || change.kind === 'clearTanks') tanks = [];
  if (change.kind === 'removeTank') tanks = tanks.filter(x => x.tank.id !== change.tankId);
  if (change.kind === 'upsertTank' && change.tank) {
    const previous = tanks.find(x => x.tank.id === change.tank!.id);
    tanks = [...tanks.filter(x => x.tank.id !== change.tank!.id),
      { tank: change.tank, revision: change.revision, authorId: previous?.authorId ?? change.userId }];
  }
  return { revision: change.revision, mapRevision: change.mapRevision,
    mapId: change.kind === 'setMap' ? change.mapId ?? null : state.mapId, strokes, tanks };
}

export function applyOptimisticSketchCommand(state: SketchState, command: SketchCommand): SketchState {
  let strokes = state.strokes;
  let tanks = state.tanks ?? [];
  let mapId = state.mapId;
  if (command.kind === 'clear' || command.kind === 'setMap') strokes = [];
  if (command.kind === 'remove') strokes = strokes.filter(x => x.stroke.id !== command.strokeId);
  if (command.kind === 'upsert' && command.stroke) {
    const previous = strokes.find(x => x.stroke.id === command.stroke!.id);
    strokes = [...strokes.filter(x => x.stroke.id !== command.stroke!.id),
      { stroke: command.stroke, revision: previous?.revision ?? 0, authorId: previous?.authorId ?? 'local' }];
  }
  if (command.kind === 'clearTanks' || command.kind === 'setMap') tanks = [];
  if (command.kind === 'removeTank') tanks = tanks.filter(x => x.tank.id !== command.tankId);
  if (command.kind === 'upsertTank' && command.tank) {
    const previous = tanks.find(x => x.tank.id === command.tank!.id);
    tanks = [...tanks.filter(x => x.tank.id !== command.tank!.id),
      { tank: command.tank, revision: previous?.revision ?? 0, authorId: previous?.authorId ?? 'local' }];
  }
  if (command.kind === 'setMap') mapId = command.mapId ?? null;
  // Never invent server revisions. Pending operations are only a visual projection.
  return { ...state, mapId, strokes, tanks };
}

export type ReplaySyncState = {
  serverId: string; sequence: number; revision: number; sessionId: string;
  replayId: string | null; mapId: string | null; leaderId: string | null; leaderConnectionId: string | null;
  time: number; minTime: number; maxTime: number; speed: number; isPlaying: boolean;
  updatedAtUnixMs: number; serverNowUnixMs: number; reason: string;
};
export type ReplayCommand = { kind: 'load' | 'play' | 'pause' | 'seek' | 'speed' | 'unload'; replayId?: string; time?: number; speed?: number };
export type ReplayTiming = { sessionId: string; revision: number; time: number; isPlaying: boolean; speed: number; sampledAtUnixMs: number };
export type ReplaySyncResult = { applied: boolean; error: string | null; state: ReplaySyncState };
export function replayTimeAt(state: ReplaySyncState, serverNow: number): number {
  return Math.min(state.maxTime, Math.max(state.minTime, state.time +
    (state.isPlaying ? Math.max(0, serverNow - state.updatedAtUnixMs) / 1000 * state.speed : 0)));
}

export function replayCorrection(remote: ReplaySyncState,
  local: { time: number; speed: number; isPlaying: boolean }, serverNow: number,
  controlChanged: boolean, leader: boolean): { time: number; speed: number; playing: boolean } | null {
  const time = replayTimeAt(remote, serverNow);
  if (controlChanged || !leader && Math.abs(local.time - time) > 2)
    return { time, speed: remote.speed, playing: remote.isPlaying };
  if (leader) return null;
  // Inside the two-second tolerance, flags can change but the picture must not jump.
  // Let a slightly lagging client finish naturally when the leader reaches the end.
  const finishing = !remote.isPlaying && time >= remote.maxTime && local.isPlaying && local.time < remote.maxTime;
  const playing = (finishing || remote.isPlaying) && local.time < remote.maxTime;
  return local.speed !== remote.speed || local.isPlaying !== playing
    ? { time: local.time, speed: remote.speed, playing } : null;
}
