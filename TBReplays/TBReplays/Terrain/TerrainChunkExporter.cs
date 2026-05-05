using System.Text.Json;
using TBReplays.Maps;

namespace TBReplays.Terrain;

public sealed class TerrainChunkExporter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public async Task<MapManifestDto> ExportAsync(
        string mapId,
        DavaHeightmap heightmap,
        TerrainBoundsDto bounds,
        string outputDirectory,
        int chunkCellSize,
        CancellationToken cancellationToken)
    {
        if (chunkCellSize <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(chunkCellSize));
        }

        Directory.CreateDirectory(outputDirectory);

        var totalCells = heightmap.Size - 1;

        var chunksX = (int)Math.Ceiling(totalCells / (double)chunkCellSize);
        var chunksY = (int)Math.Ceiling(totalCells / (double)chunkCellSize);

        var chunks = new List<TerrainChunkInfoDto>(chunksX * chunksY);

        for (var chunkY = 0; chunkY < chunksY; chunkY++)
        {
            for (var chunkX = 0; chunkX < chunksX; chunkX++)
            {
                var startSampleX = chunkX * chunkCellSize;
                var startSampleY = chunkY * chunkCellSize;

                var cellsX = Math.Min(chunkCellSize, totalCells - startSampleX);
                var cellsY = Math.Min(chunkCellSize, totalCells - startSampleY);

                var width = cellsX + 1;
                var height = cellsY + 1;

                var fileName = GetChunkFileName(chunkX, chunkY);
                var filePath = Path.Combine(outputDirectory, fileName);

                await WriteChunkAsync(
                    filePath,
                    heightmap,
                    startSampleX,
                    startSampleY,
                    width,
                    height,
                    cellsX,
                    cellsY,
                    cancellationToken);

                chunks.Add(new TerrainChunkInfoDto(
                    X: chunkX,
                    Y: chunkY,
                    StartSampleX: startSampleX,
                    StartSampleY: startSampleY,
                    Width: width,
                    Height: height,
                    CellsX: cellsX,
                    CellsY: cellsY,
                    Url: $"/api/maps/{mapId}/terrain/chunks/{chunkX}/{chunkY}"));
            }
        }

        var manifest = new MapManifestDto(
            MapId: mapId,
            HeightmapSize: heightmap.Size,
            HeightmapTileSize: heightmap.TileSize,
            ChunkCellSize: chunkCellSize,
            ChunksX: chunksX,
            ChunksY: chunksY,
            Bounds: bounds,
            Chunks: chunks);

        var manifestPath = Path.Combine(outputDirectory, "manifest.json");
        var manifestJson = JsonSerializer.Serialize(manifest, JsonOptions);

        await File.WriteAllTextAsync(manifestPath, manifestJson, cancellationToken);

        return manifest;
    }

    public static string GetChunkFileName(int chunkX, int chunkY)
    {
        return $"chunk_{chunkX}_{chunkY}.bin";
    }

    private static async Task WriteChunkAsync(
        string filePath,
        DavaHeightmap heightmap,
        int startSampleX,
        int startSampleY,
        int width,
        int height,
        int cellsX,
        int cellsY,
        CancellationToken cancellationToken)
    {
        await using var fileStream = File.Create(filePath);
        await using var writer = new BinaryWriter(fileStream);

        writer.Write(width);
        writer.Write(height);
        writer.Write(startSampleX);
        writer.Write(startSampleY);
        writer.Write(cellsX);
        writer.Write(cellsY);

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var sourceX = startSampleX + x;
                var sourceY = startSampleY + y;

                var rawHeight = heightmap.GetRawHeight(sourceX, sourceY);
                writer.Write(rawHeight);
            }
        }

        await fileStream.FlushAsync(cancellationToken);
    }
}