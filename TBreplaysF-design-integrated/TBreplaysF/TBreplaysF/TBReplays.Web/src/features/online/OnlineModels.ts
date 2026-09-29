import type { DrawingStrokeModel } from '../../domain/DrawingModels';
export type OnlineUser = { id: string; login: string; role: 'admin' | 'editor' | 'observer' };
export type StoredStroke = { stroke: DrawingStrokeModel; revision: number; authorId: string };
export type SketchState = { revision: number; mapId: string | null; mapRevision: number; strokes: StoredStroke[] };
export type SketchCommand = { operationId: string; kind: 'upsert' | 'remove' | 'clear' | 'setMap';
  expectedRevision: number; mapRevision: number; stroke?: DrawingStrokeModel; strokeId?: string; mapId?: string };
export type SketchChange = SketchCommand & { revision: number; userId: string };
export type SketchResult = { applied: boolean; error: string | null; change: SketchChange | null };
export type OnlineState = { board: SketchState | null; users: OnlineUser[];
  status: 'connecting' | 'connected' | 'reconnecting' | 'offline'; pending: boolean; message: string };
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
  return { revision: change.revision, mapRevision: change.mapRevision,
    mapId: change.kind === 'setMap' ? change.mapId ?? null : state.mapId, strokes };
}
