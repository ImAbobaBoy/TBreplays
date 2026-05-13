import * as THREE from 'three';

import type {
  CoordinateTransformCalibration,
  MapCalibration,
} from '../domain/MapCalibration';

const fallbackTerrainTransform: CoordinateTransformCalibration = {
  swapXz: false,
  flipX: false,
  flipZ: true,
  rotationDegrees: 0,
};

const fallbackReplayTransform: CoordinateTransformCalibration = {
  swapXz: false,
  flipX: false,
  flipZ: false,
  rotationDegrees: 0,
};

export function getTerrainTransform(
  calibration: MapCalibration | null,
): CoordinateTransformCalibration {
  return calibration?.terrainTransform ?? fallbackTerrainTransform;
}

export function getReplayTransform(
  calibration: MapCalibration | null,
): CoordinateTransformCalibration {
  return calibration?.replayTransform ?? fallbackReplayTransform;
}

export function mapTerrainSampleToThree(
  sourceX: number,
  sourceZ: number,
  height: number,
  calibration: MapCalibration | null,
): THREE.Vector3 {
  const horizontal = applyHorizontalTransform(
    sourceX,
    sourceZ,
    getTerrainTransform(calibration),
  );

  return new THREE.Vector3(
    horizontal.x,
    height,
    horizontal.z,
  );
}

export function mapReplayPositionToThree(
  x: number,
  y: number,
  z: number,
  calibration: MapCalibration | null,
): THREE.Vector3 {
  const horizontal = applyHorizontalTransform(
    x,
    z,
    getReplayTransform(calibration),
  );

  return new THREE.Vector3(
    horizontal.x,
    y,
    horizontal.z,
  );
}

function applyHorizontalTransform(
  sourceX: number,
  sourceZ: number,
  transform: CoordinateTransformCalibration,
): { x: number; z: number } {
  let x = sourceX;
  let z = sourceZ;

  if (transform.swapXz) {
    const oldX = x;
    x = z;
    z = oldX;
  }

  if (transform.flipX) {
    x = -x;
  }

  if (transform.flipZ) {
    z = -z;
  }

  if (transform.rotationDegrees !== 0) {
    const angle = THREE.MathUtils.degToRad(transform.rotationDegrees);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const rotatedX = x * cos - z * sin;
    const rotatedZ = x * sin + z * cos;

    x = rotatedX;
    z = rotatedZ;
  }

  return { x, z };
}