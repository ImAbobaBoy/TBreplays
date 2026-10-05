import type { ReplayReloadFrame } from '../../domain/ReplayModels';

export function selectReplayReload(frames: readonly ReplayReloadFrame[], time: number): {
  fraction: number | null; remainingSeconds: number | null;
} {
  let lo = 0, hi = frames.length - 1, index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].time <= time) { index = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const frame = frames[index];
  if (!frame || !Number.isFinite(time) || frame.durationSeconds == null) return { fraction: null, remainingSeconds: null };
  if (frame.startedAt == null) return { fraction: 1, remainingSeconds: 0 };
  if (frame.readyAt == null) return { fraction: null, remainingSeconds: null };
  const remainingSeconds = Math.max(0, frame.readyAt - time);
  const duration = frame.readyAt - frame.startedAt;
  return { fraction: duration > 0 ? Math.max(0, Math.min(1, (time - frame.startedAt) / duration)) : 1, remainingSeconds };
}
