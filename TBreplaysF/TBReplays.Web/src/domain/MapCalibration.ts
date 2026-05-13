export type MapCalibration = {
  mapId: string;
  mapKey: string;
  replayMapName: string | null;

  world: {
    horizontalHalfExtent: number;
  };

  height: {
    scale: number;
    offset: number;
    source: string;
    confidence: number;
    note: string | null;
  };

  terrainTransform: CoordinateTransformCalibration;
  replayTransform: CoordinateTransformCalibration;

  objects: {
    heightOffset: number;
  };

  texture: {
    rotationDegrees: number;
    flipU: boolean;
    flipV: boolean;
  };

  surface: {
    colorTexturePath: string | null;
    tileMaskPath: string | null;
    tileTexture0Path: string | null;
    landscapeTexturePaths: string[];
  };

  heightmapStats: {
    size: number;
    tileSize: number;
    rawMin: number;
    rawMax: number;
    rawP01: number;
    rawP50: number;
    rawP99: number;
  };
};

export type CoordinateTransformCalibration = {
  swapXz: boolean;
  flipX: boolean;
  flipZ: boolean;
  rotationDegrees: number;
};