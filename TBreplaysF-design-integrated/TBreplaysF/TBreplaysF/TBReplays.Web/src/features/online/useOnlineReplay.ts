import { useEffect, useRef, useState } from 'react';
import type { ViewerEngine } from '../../engine/ViewerEngine';
import { useOnline } from './OnlineRoot';
import { replayCorrection } from './OnlineModels';

// Each browser downloads the presentation once per selected replay. Only commands and clock anchors travel over the hub.
export function useOnlineReplay(engine: ViewerEngine | null, mapReady: boolean,
  onLoaded: (id: string | null) => void, report: (message: string) => void) {
  const online = useOnline();
  const remote = online.state.replay;
  const latest = useRef({ online, onLoaded, report });
  latest.current = { online, onLoaded, report };
  const [loaded, setLoaded] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const applied = useRef<{ sequence: number; revision: number } | null>(null);
  const key = remote ? `${remote.serverId}:${remote.sessionId}` : null;
  const boardMap = online.state.board?.mapId;
  useEffect(() => {
    setLoaded(null); setError(''); applied.current = null;
    if (!engine) return;
    engine.clearReplay(); latest.current.onLoaded(null);
    if (!mapReady || !remote?.replayId || remote.mapId !== boardMap) return;
    let active = true;
    latest.current.report('Загружаю общий реплей…');
    void engine.loadReplay(remote.replayId).then(() => {
      if (!active) return;
      latest.current.onLoaded(remote.replayId);
      setLoaded(key);
      latest.current.report('Общий реплей загружен.');
    }).catch(cause => {
      if (!active) return;
      const message = cause instanceof Error ? cause.message : 'Не удалось загрузить реплей.';
      setError(message); latest.current.report(message);
    });
    return () => { active = false; engine.clearReplay(); };
  }, [engine, mapReady, key, remote?.replayId, remote?.mapId, boardMap, retry]);

  useEffect(() => {
    if (!engine || !remote?.replayId || loaded !== key) return;
    if (online.state.status !== 'connected') {
      engine.pauseReplay(); applied.current = null; return;
    }
    if (applied.current?.sequence === remote.sequence) return;
    const previous = applied.current;
    const leader = online.state.connectionId === remote.leaderConnectionId;
    const correction = replayCorrection(remote, engine.getReplayPlaybackState(),
      Date.now() + online.state.clockOffsetMs, previous?.revision !== remote.revision, leader);
    if (correction) engine.synchronizeReplay(correction.time, correction.speed, correction.playing);
    applied.current = { sequence: remote.sequence, revision: remote.revision };
  }, [engine, loaded, key, remote, online.state.status, online.state.connectionId, online.state.clockOffsetMs]);

  useEffect(() => {
    if (!engine || !loaded || loaded !== key) return;
    let sending = false;
    const tick = async () => {
      const state = latest.current.online.client.getSnapshot();
      const replay = state.replay;
      if (sending || state.status !== 'connected' || !replay?.replayId
        || `${replay.serverId}:${replay.sessionId}` !== loaded || !state.connectionId
        || state.connectionId !== replay.leaderConnectionId || applied.current?.revision !== replay.revision) return;
      const local = engine.getReplayPlaybackState();
      if (local.replayId !== replay.replayId) return;
      sending = true;
      try {
        await latest.current.online.client.sendReplayTiming({ sessionId: replay.sessionId, revision: replay.revision,
          time: local.time, speed: local.speed, isPlaying: local.isPlaying,
          sampledAtUnixMs: Math.round(Date.now() + state.clockOffsetMs) });
      } finally { sending = false; }
    };
    const timer = setInterval(() => { void tick(); }, 5000);
    return () => clearInterval(timer);
  }, [engine, loaded, key]);
  return { error, retry: () => setRetry(value => value + 1) };
}
