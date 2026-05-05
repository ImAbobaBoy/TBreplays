namespace TBReplays.Terrain;

public sealed record DavaHeightmap(
    int Size,
    int TileSize,
    ushort[] RawHeights)
{
    public ushort GetRawHeight(int x, int y)
    {
        if ((uint)x >= Size)
        {
            throw new ArgumentOutOfRangeException(nameof(x));
        }

        if ((uint)y >= Size)
        {
            throw new ArgumentOutOfRangeException(nameof(y));
        }

        return RawHeights[y * Size + x];
    }
}