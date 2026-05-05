using System.Buffers.Binary;

namespace TBReplays.Terrain;

public sealed class DavaHeightmapReader
{
    private const int HeaderSize = 8;

    public DavaHeightmap Read(byte[] bytes)
    {
        if (bytes.Length < HeaderSize)
        {
            throw new InvalidDataException("Heightmap слишком маленький.");
        }

        var size = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(0, 4));
        var tileSize = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(4, 4));

        if (size <= 0)
        {
            throw new InvalidDataException($"Некорректный размер heightmap: {size}.");
        }

        if (tileSize <= 0)
        {
            throw new InvalidDataException($"Некорректный tile size: {tileSize}.");
        }

        if (size % tileSize != 0)
        {
            throw new InvalidDataException($"Heightmap size {size} не делится на tile size {tileSize}.");
        }

        var expectedLength = HeaderSize + (long)size * size * sizeof(ushort);

        if (bytes.LongLength != expectedLength)
        {
            throw new InvalidDataException(
                $"Некорректный размер heightmap. Ожидалось {expectedLength}, получено {bytes.LongLength}.");
        }

        var rawHeights = new ushort[size * size];

        var blocksPerSide = size / tileSize;
        var sourceOffset = HeaderSize;

        for (var blockY = 0; blockY < blocksPerSide; blockY++)
        {
            for (var blockX = 0; blockX < blocksPerSide; blockX++)
            {
                for (var localY = 0; localY < tileSize; localY++)
                {
                    for (var localX = 0; localX < tileSize; localX++)
                    {
                        var rawHeight = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(sourceOffset, 2));
                        sourceOffset += sizeof(ushort);

                        var x = blockX * tileSize + localX;
                        var y = blockY * tileSize + localY;

                        rawHeights[y * size + x] = rawHeight;
                    }
                }
            }
        }

        return new DavaHeightmap(size, tileSize, rawHeights);
    }
}