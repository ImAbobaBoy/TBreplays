export type TerrainBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  width: number;
  depth: number;
  height: number;
};

export type TerrainChunkInfo = {
  x: number;
  y: number;
  startSampleX: number;
  startSampleY: number;
  width: number;
  height: number;
  cellsX: number;
  cellsY: number;
  url: string;
};

export type MapManifest = {
  mapId: string;
  heightmapSize: number;
  heightmapTileSize: number;
  chunkCellSize: number;
  chunksX: number;
  chunksY: number;
  bounds: TerrainBounds;
  chunks: TerrainChunkInfo[];
};

export type TerrainChunkData = {
  width: number;
  height: number;
  startSampleX: number;
  startSampleY: number;
  cellsX: number;
  cellsY: number;
  heights: Uint16Array;
};

export type TerrainTextureManifest = {
  mapId: string;
  fileName: string;
  sizeBytes: number;
  url: string;
};

export type MapObjectMeshMaterial = {
  index: number;
  name?: string | null;
  textureUrl?: string | null;
};

export type MapObjectMeshManifest = {
  mapId: string;
  vertexCount: number;
  indexCount: number;
  url: string;
  materials?: MapObjectMeshMaterial[];
};

export type MapObjectVector3 = {
  x: number;
  y: number;
  z: number;
};

export type MapEffectDto = {
  id: string | number;
  kind: string;
  position: MapObjectVector3;
  radius: number;
  height: number;
};

export type MapEffectSet = {
  mapId: string;
  effects: MapEffectDto[];
};