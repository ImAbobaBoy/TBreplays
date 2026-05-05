namespace TBReplays.Maps;

public sealed record TerrainChunkInfoDto(
    int X,
    int Y,
    int StartSampleX,
    int StartSampleY,
    int Width,
    int Height,
    int CellsX,
    int CellsY,
    string Url);