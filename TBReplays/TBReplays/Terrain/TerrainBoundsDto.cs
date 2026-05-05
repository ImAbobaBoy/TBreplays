namespace TBReplays.Terrain;

public sealed record TerrainBoundsDto(
    float MinX,
    float MinY,
    float MinZ,
    float MaxX,
    float MaxY,
    float MaxZ)
{
    public float Width => MaxX - MinX;
    public float Depth => MaxY - MinY;
    public float Height => MaxZ - MinZ;
}