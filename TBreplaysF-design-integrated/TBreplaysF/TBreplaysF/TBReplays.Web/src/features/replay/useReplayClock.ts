import { useEffect, useRef, useState } from 'react';
import type { ReplayPlaybackState } from '../../domain/ReplayModels';

/** Only animate these small HUD components, not the workspace or network state. */
export function useReplayClock(playback: ReplayPlaybackState): number {
  const sample = useRef({ playback, at: performance.now() });
  const [time, setTime] = useState(playback.time);
  useEffect(() => {
    sample.current = { playback, at: performance.now() };
    setTime(playback.time);
  }, [playback.time, playback.isPlaying, playback.speed, playback.replayId, playback.revision]);
  useEffect(() => {
    if (!playback.isPlaying) return;
    let frame = 0, last = 0;
    const tick = (now: number) => {
      if (now - last >= 1000 / 30) {
        const { playback: p, at } = sample.current;
        setTime(Math.min(p.maxTime, Math.max(p.minTime, p.time + (now - at) / 1000 * p.speed)));
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playback.isPlaying]);
  return playback.isPlaying ? time : playback.time;
}
