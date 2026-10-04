import { useEffect, useRef, useState } from 'react';
import type { ViewerEngine } from '../../engine/ViewerEngine';
import type { AppMode } from '../../app/AppMode';
import { useOnline } from './OnlineRoot';

export function useOnlineViewer(engine: ViewerEngine | null, loadMap: (id: string) => Promise<void>, mode: AppMode, report: (message: string) => void) {
  const online = useOnline();
  const latest = useRef({ online, loadMap, report });
  latest.current = { online, loadMap, report };
  const [ready, setReady] = useState<{ engine: ViewerEngine; mapId: string } | null>(null);
  const queue = useRef(Promise.resolve());
  const epoch = useRef(-1);
  const slideId = online.state.board?.slideId;
  const mapId = online.state.board?.mapId;
  const preloadIds = [...new Set((online.state.workspace?.slides ?? []).map(slide => slide.mapId))];
  const preloadKey = JSON.stringify(preloadIds);
  useEffect(() => {
    if (engine && ready?.engine === engine) engine.preloadMaps(JSON.parse(preloadKey) as string[]);
  }, [engine, ready, preloadKey]);
  useEffect(() => {
    setReady(null); epoch.current = -1;
    if (!engine) return;
    engine.setOnlineDrawingAccess(false);
    let active = true;
    if (!mapId) { engine.clearMap(); return; }
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!active) return;
      try {
        await latest.current.loadMap(mapId);
        if (active) setReady({ engine, mapId });
      } catch { if (active) latest.current.report('Не удалось загрузить общую карту. Проверьте доступность карты на сервере и обновите страницу.'); }
    });
    return () => { active = false; };
  }, [engine, mapId, slideId]);
  useEffect(() => {
    if (!engine || ready?.engine !== engine || ready.mapId !== mapId || !online.state.board) return;
    const board = online.state.board;
    engine.syncOnlineStrokes(board.strokes.map(x => x.stroke), epoch.current !== board.mapRevision);
    epoch.current = board.mapRevision;
  }, [engine, ready, mapId, online.state.board]);
  useEffect(() => {
    engine?.setOnlineDrawingAccess(online.canEdit && ready?.engine === engine && ready?.mapId === mapId);
    if (!online.canEdit) engine?.setManualTanks((online.client.getSnapshot().board?.tanks ?? []).map(x => x.tank));
  }, [engine, ready, mapId, online.canEdit, mode]);
  useEffect(() => {
    if (!engine) return;
    const restore = () => {
      const board = latest.current.online.client.getSnapshot().board;
      if (board) engine.syncOnlineStrokes(board.strokes.map(x => x.stroke));
    };
    engine.setDrawingHandlers({
      upsert: stroke => {
        const current = latest.current.online;
        const board = current.client.getSnapshot().board;
        if (!current.canEdit || !board) { restore(); return; }
        void current.client.apply({ kind: 'upsert', expectedRevision: 0, stroke }).catch(() => {}).finally(restore);
      },
      remove: id => {
        const current = latest.current.online;
        const stored = current.client.getSnapshot().board?.strokes.find(x => x.stroke.id === id);
        if (!current.canEdit || !stored) return;
        void current.client.apply({ kind: 'remove', expectedRevision: stored.revision, strokeId: id }).catch(() => {}).finally(restore);
      },
    });
    return () => engine.setDrawingHandlers(null);
  }, [engine]);
  return ready?.engine === engine && ready?.mapId === mapId && !!mapId;
}
