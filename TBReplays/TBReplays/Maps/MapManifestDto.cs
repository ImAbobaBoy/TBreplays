using TBReplays.Terrain;

namespace TBReplays.Maps;

public sealed record MapManifestDto(
    string MapId,
    int HeightmapSize,
    int HeightmapTileSize,
    int ChunkCellSize,
    int ChunksX,
    int ChunksY,
    TerrainBoundsDto Bounds,
    IReadOnlyList<TerrainChunkInfoDto> Chunks);