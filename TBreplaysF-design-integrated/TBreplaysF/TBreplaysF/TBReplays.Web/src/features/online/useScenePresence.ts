import { useEffect, useRef } from 'react';
import type { ViewerEngine } from '../../engine/ViewerEngine';
import { useOnline } from './OnlineRoot';

export function useScenePresence(engine: ViewerEngine | null, ready: boolean, follow: boolean) {
  const online = useOnline();
  const latest = useRef(online); latest.current = online;
  const sequence = useRef(0);
  const presenter = online.state.workspace?.presenterConnectionId;
  const activeSlide = online.state.workspace?.activeSlideId;
  const following = !!presenter && presenter !== online.state.connectionId && follow;
  useEffect(() => {
    if (!engine) return;
    engine.setFollowingCamera(ready && following);
    const refresh = () => {
      const current = latest.current;
      const editors = new Set(current.state.users.filter(user => user.role !== 'observer').map(user => user.id));
      const frames = current.client.getScenePresence().filter(frame => frame.slideId === current.state.workspace?.activeSlideId && editors.has(frame.userId));
      engine.setEditorCursors(ready ? frames.map(frame => ({ ...frame, updatedAtUnixMs: frame.updatedAtUnixMs - current.state.clockOffsetMs })) : []);
      const camera = frames.find(frame => frame.connectionId === current.state.workspace?.presenterConnectionId)?.camera;
      if (following && ready && camera) engine.followCamera(camera);
    };
    refresh();
    const unsubscribe = online.client.subscribeScenePresence(refresh);
    if (ready && online.state.status === 'connected') void online.client.refreshScenePresence().catch(() => {});
    return () => { unsubscribe(); engine.setFollowingCamera(false); engine.setEditorCursors([]); };
  }, [engine, ready, following, presenter, activeSlide, online.client, online.state.users, online.state.status]);
  useEffect(() => {
    if (!engine) return;
    engine.setScenePresenceHandler(ready && online.canEdit ? (cursor, camera) => {
      const current = latest.current;
      const slideId = current.state.workspace?.activeSlideId;
      if (!slideId || !current.canEdit) return;
      current.client.sendScenePresence({ slideId, sequence: ++sequence.current, cursor,
        camera: current.state.workspace?.presenterConnectionId === current.state.connectionId ? camera : null });
    } : null);
    return () => engine.setScenePresenceHandler(null);
  }, [engine, ready, online.canEdit, online.client, activeSlide, presenter]);
}
