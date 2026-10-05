import * as THREE from 'three';
import type { ReplayMovementSample } from '../../domain/ReplayModels';

// Same lightness ordering for both teams: heavy < medium < light < destroyer.
const shades: Record<string, readonly [string, string]> = {
  heavyTank: ['#1e40af', '#991b1b'],
  mediumTank: ['#2563eb', '#dc2626'],
  lightTank: ['#60a5fa', '#f87171'],
  'AT-SPG': ['#bfdbfe', '#fecaca'],
};
export function replayTankColor(kind: 'ally' | 'enemy' | 'neutral', vehicleClass?: string, dimmed = false): string {
  const hex = kind === 'neutral' ? '#a3a3a3' : (shades[vehicleClass ?? ''] ?? shades.mediumTank)[kind === 'enemy' ? 1 : 0];
  return dimmed ? `#${new THREE.Color(hex).multiplyScalar(.4).getHexString()}` : hex;
}

export const REPLAY_TIME_START_COLOR = '#38bdf8';
export const REPLAY_TIME_END_COLOR = '#facc15';
const start = new THREE.Color(REPLAY_TIME_START_COLOR), end = new THREE.Color(REPLAY_TIME_END_COLOR);
export function replayPathColor(fraction: number, target = new THREE.Color()): THREE.Color {
  return target.copy(start).lerp(end, THREE.MathUtils.clamp(fraction, 0, 1));
}

/** Concatenate observed distances, without inventing a bridge across hidden/teleported sections. */
export function replayPathProgress(segments: readonly (readonly ReplayMovementSample[])[]) {
  const fractions = new Map<ReplayMovementSample, number>();
  let distance = 0, startTime: number | null = null, endTime: number | null = null;
  for (const samples of segments) for (let i = 0; i < samples.length; i++) {
    const sample = samples[i], previous = samples[i - 1];
    const step = previous ? Math.hypot(sample.x - previous.x, sample.y - previous.y, sample.z - previous.z) : 0;
    if (step > 0) { startTime ??= previous.time; endTime = sample.time; }
    distance += step;
    fractions.set(sample, distance);
  }
  for (const [sample, travelled] of fractions) fractions.set(sample, distance > 0 ? travelled / distance : 0);
  return { fractions, distance, startTime, endTime };
}
