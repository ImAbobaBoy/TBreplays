import { useEffect, useRef } from 'react';
import type { ManualTankModel } from '../../domain/TankModels';
import type { ViewerEngine } from '../../engine/ViewerEngine';
import { useOnline } from './OnlineRoot';

// Broadcast final poses on mouse release; playback and cameras remain local.
export function useOnlineTanks(engine: ViewerEngine | null, setTanks: (tanks: ManualTankModel[]) => void) {
  const online = useOnline();
  const latest = useRef({ online, setTanks });
  latest.current = { online, setTanks };
  const edit = useRef<{ id: string; revision: number; mapRevision: number; slideId?: string | null } | null>(null);
  const restore = () => {
    const tanks = latest.current.online.client.getSnapshot().board?.tanks ?? [];
    latest.current.setTanks(tanks.map(x => x.tank));
  };
  const commit = (tank: ManualTankModel, drag = false) => {
    const current = latest.current.online;
    const board = current.client.getSnapshot().board;
    const started = drag && edit.current?.id === tank.id ? edit.current : null;
    edit.current = null;
    if (!current.canEdit || !board || started && started.slideId !== board.slideId) { restore(); return; }
    const stored = board.tanks?.find(x => x.tank.id === tank.id);
    void current.client.apply({ kind: 'upsertTank', tank,
      expectedRevision: started?.revision ?? stored?.revision ?? 0,
      mapRevision: started?.mapRevision ?? board.mapRevision }).catch(() => {}).finally(restore);
  };
  const remove = (tankId: string) => {
    const current = latest.current.online;
    const stored = current.client.getSnapshot().board?.tanks?.find(x => x.tank.id === tankId);
    if (!current.canEdit || !stored) return;
    void current.client.apply({ kind: 'removeTank', tankId, expectedRevision: stored.revision }).catch(() => {}).finally(restore);
  };
  const clear = () => {
    const current = latest.current.online;
    const board = current.client.getSnapshot().board;
    if (!current.canEdit || !board || !window.confirm('Удалить все танковые метки для всех участников?')) return;
    void current.client.apply({ kind: 'clearTanks', expectedRevision: board.revision }).catch(() => {}).finally(restore);
  };
  const actions = useRef({ commit, remove });
  actions.current = { commit, remove };
  useEffect(() => {
    if (!engine) return;
    engine.setTankOnlineHandlers({
      begin: id => {
        const board = latest.current.online.client.getSnapshot().board;
        const stored = board?.tanks?.find(x => x.tank.id === id);
        edit.current = board && stored ? { id, revision: stored.revision, mapRevision: board.mapRevision, slideId: board.slideId } : null;
      },
      commit: tank => actions.current.commit(tank, true),
      remove: id => actions.current.remove(id),
    });
    return () => { engine.setTankOnlineHandlers(null); edit.current = null; };
  }, [engine]);
  useEffect(() => { restore(); }, [online.state.board, online.state.status, engine]);
  return { commit, remove, clear };
}
