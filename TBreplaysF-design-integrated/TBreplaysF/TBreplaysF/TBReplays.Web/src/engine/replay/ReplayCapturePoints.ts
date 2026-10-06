import type { ReplayCapturePointEvent } from '../../domain/ReplayModels';

export function capturePointTracks(events: ReplayCapturePointEvent[]): Map<number, ReplayCapturePointEvent[]> {
  const tracks = new Map<number, ReplayCapturePointEvent[]>();
  for (const event of events) {
    const track = tracks.get(event.pointId) ?? [];
    track.push(event); tracks.set(event.pointId, track);
  }
  for (const track of tracks.values()) track.sort((a,b) => a.time-b.time || a.packetIndex-b.packetIndex);
  return tracks;
}

export function sampleCapturePoint(track: ReplayCapturePointEvent[], time: number): ReplayCapturePointEvent | null {
  let left = 0, right = track.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (track[middle].time <= time) left = middle + 1; else right = middle;
  }
  const current = track[left-1];
  if (!current) return null;
  const next = track[left];
  // Interpolate only between adjacent measured states of the same capture.
  // Never predict from a fixed rate or bridge pauses, resets or ownership changes.
  if (next && current.capturingTeamId !== 0 && next.capturingTeamId === current.capturingTeamId
      && next.ownerTeamId === current.ownerTeamId && next.time-current.time <= 1
      && next.progress >= current.progress && next.time > current.time) {
    const alpha = (time-current.time)/(next.time-current.time);
    return { ...current, progress: current.progress+(next.progress-current.progress)*alpha };
  }
  return current;
}
