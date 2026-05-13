using System.Text.Json;
using TBReplays.Terrain;

namespace TBReplays.Maps.Calibration;

public sealed class MapCalibrationService
{
    private const float DefaultHorizontalHalfExtent = 300f;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private static readonly IReadOnlyDictionary<string, KnownMapCalibration> KnownCalibrations =
        new Dictionary<string, KnownMapCalibration>(StringComparer.OrdinalIgnoreCase)
        {
            ["07_fort_ft"] = new(
                ReplayMapName: "fort",
                HeightScale: 0.0010761895f,
                HeightOffset: -0.181338f,
                HeightSource: "replay-fit",
                Confidence: 0.998f,
                TerrainSwapXz: false,
                TerrainFlipX: false,
                TerrainFlipZ: true,
                Note: "Калибровано по replay fort."),

            ["18_canal_cn"] = new(
                ReplayMapName: "canal",
                HeightScale: 0.002120f,
                HeightOffset: 0.258878f,
                HeightSource: "replay-fit",
                Confidence: 0.9996f,
                TerrainSwapXz: false,
                TerrainFlipX: false,
                TerrainFlipZ: true,
                Note: "Калибровано по специальному replay canal. flipZ относится к выборке heightmap."),

            ["32_faust_fa_night"] = new(
                ReplayMapName: "faust",
                HeightScale: 0.0010535726f,
                HeightOffset: 10.569529f,
                HeightSource: "replay-fit-experimental",
                Confidence: 0.833f,
                TerrainSwapXz: true,
                TerrainFlipX: false,
                TerrainFlipZ: true,
                Note: "Пробная калибровка. SwapXz нужно проверить глазами.")
        };

    public async Task<MapCalibrationDto> CreateAndSaveAsync(
        string mapId,
        string archiveFileName,
        DavaHeightmap heightmap,
        string importedDirectory,
        string processedDirectory,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(processedDirectory);

        var path = Path.Combine(processedDirectory, "map_calibration.json");

        if (File.Exists(path))
        {
            return await ReadAsync(
                processedDirectory,
                cancellationToken);
        }

        var calibration = Create(
            mapId,
            archiveFileName,
            heightmap,
            importedDirectory);

        var json = JsonSerializer.Serialize(calibration, JsonOptions);

        await File.WriteAllTextAsync(path, json, cancellationToken);

        return calibration;
    }

    public async Task<MapCalibrationDto> SaveAsync(
        string processedDirectory,
        MapCalibrationDto calibration,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(processedDirectory);

        var path = Path.Combine(processedDirectory, "map_calibration.json");
        var json = JsonSerializer.Serialize(calibration, JsonOptions);

        await File.WriteAllTextAsync(path, json, cancellationToken);

        return calibration;
    }
    
    public async Task<MapCalibrationDto> ReadAsync(
        string processedDirectory,
        CancellationToken cancellationToken)
    {
        var path = Path.Combine(processedDirectory, "map_calibration.json");

        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                "map_calibration.json не найден. Переимпортируй карту после добавления MapCalibrationService.",
                path);
        }

        await using var stream = File.OpenRead(path);

        var calibration = await JsonSerializer.DeserializeAsync<MapCalibrationDto>(
            stream,
            JsonOptions,
            cancellationToken);

        return calibration ?? throw new InvalidDataException("map_calibration.json повреждён.");
    }

    public TerrainBoundsDto CreateTerrainBounds(MapCalibrationDto calibration)
    {
        var half = calibration.World.HorizontalHalfExtent;

        var minZ = calibration.Height.Offset;
        var maxZ = calibration.Height.Offset + calibration.Height.Scale * ushort.MaxValue;

        return new TerrainBoundsDto(
            MinX: -half,
            MinY: -half,
            MinZ: minZ,
            MaxX: half,
            MaxY: half,
            MaxZ: maxZ);
    }

    private static MapCalibrationDto Create(
        string mapId,
        string archiveFileName,
        DavaHeightmap heightmap,
        string importedDirectory)
    {
        var mapKey = CreateMapKey(archiveFileName);
        var stats = CreateHeightmapStats(heightmap);
        var surface = CreateSurfaceCalibration(importedDirectory);

        if (KnownCalibrations.TryGetValue(mapKey, out var known))
        {
            return new MapCalibrationDto(
                MapId: mapId,
                MapKey: mapKey,
                ReplayMapName: known.ReplayMapName,
                World: new MapCalibrationWorldDto(DefaultHorizontalHalfExtent),
                Height: new MapCalibrationHeightDto(
                    Scale: known.HeightScale,
                    Offset: known.HeightOffset,
                    Source: known.HeightSource,
                    Confidence: known.Confidence,
                    Note: known.Note),
                TerrainTransform: new MapCalibrationCoordinateTransformDto(
                    SwapXz: known.TerrainSwapXz,
                    FlipX: known.TerrainFlipX,
                    FlipZ: known.TerrainFlipZ,
                    RotationDegrees: 0f),
                ReplayTransform: new MapCalibrationCoordinateTransformDto(
                    SwapXz: false,
                    FlipX: false,
                    FlipZ: false,
                    RotationDegrees: 0f),
                Objects: new MapObjectCalibrationDto(HeightOffset: 0f),
                Texture: new MapTextureCalibrationDto(
                    RotationDegrees: 0f,
                    FlipU: false,
                    FlipV: false),
                Surface: surface,
                HeightmapStats: stats);
        }

        var fallbackScale = 82f / ushort.MaxValue;

        return new MapCalibrationDto(
            MapId: mapId,
            MapKey: mapKey,
            ReplayMapName: null,
            World: new MapCalibrationWorldDto(DefaultHorizontalHalfExtent),
            Height: new MapCalibrationHeightDto(
                Scale: fallbackScale,
                Offset: 0f,
                Source: "fallback-current-default",
                Confidence: 0f,
                Note: "Fallback повторяет старую логику MaxZ=82. Нужна ручная/replay калибровка."),
            TerrainTransform: new MapCalibrationCoordinateTransformDto(
                SwapXz: false,
                FlipX: false,
                FlipZ: true,
                RotationDegrees: 0f),
            ReplayTransform: new MapCalibrationCoordinateTransformDto(
                SwapXz: false,
                FlipX: false,
                FlipZ: false,
                RotationDegrees: 0f),
            Objects: new MapObjectCalibrationDto(HeightOffset: 0f),
            Texture: new MapTextureCalibrationDto(
                RotationDegrees: 0f,
                FlipU: false,
                FlipV: false),
            Surface: surface,
            HeightmapStats: stats);
    }

    private static string CreateMapKey(string archiveFileName)
    {
        var name = Path.GetFileNameWithoutExtension(archiveFileName);

        var safeChars = name
            .Select(x => char.IsLetterOrDigit(x) || x is '-' or '_' ? x : '_')
            .ToArray();

        return new string(safeChars)
            .Trim('_', '-')
            .ToLowerInvariant();
    }

    private static MapHeightmapStatsDto CreateHeightmapStats(DavaHeightmap heightmap)
    {
        var histogram = new int[ushort.MaxValue + 1];

        ushort rawMin = ushort.MaxValue;
        ushort rawMax = ushort.MinValue;

        foreach (var rawHeight in heightmap.RawHeights)
        {
            histogram[rawHeight]++;

            if (rawHeight < rawMin)
            {
                rawMin = rawHeight;
            }

            if (rawHeight > rawMax)
            {
                rawMax = rawHeight;
            }
        }

        return new MapHeightmapStatsDto(
            Size: heightmap.Size,
            TileSize: heightmap.TileSize,
            RawMin: rawMin,
            RawMax: rawMax,
            RawP01: ReadPercentile(histogram, heightmap.RawHeights.Length, 0.01),
            RawP50: ReadPercentile(histogram, heightmap.RawHeights.Length, 0.50),
            RawP99: ReadPercentile(histogram, heightmap.RawHeights.Length, 0.99));
    }

    private static double ReadPercentile(
        int[] histogram,
        int totalCount,
        double percentile)
    {
        var targetIndex = (int)Math.Round((totalCount - 1) * percentile);
        var current = 0;

        for (var value = 0; value < histogram.Length; value++)
        {
            current += histogram[value];

            if (current > targetIndex)
            {
                return value;
            }
        }

        return ushort.MaxValue;
    }

    private static MapSurfaceCalibrationDto CreateSurfaceCalibration(string importedDirectory)
    {
        var landscapeTextures = Directory
            .EnumerateFiles(importedDirectory, "*.*", SearchOption.AllDirectories)
            .Where(IsLandscapeTexture)
            .Select(x => ToRelativeMapPath(importedDirectory, x))
            .OrderBy(x => x)
            .ToArray();

        return new MapSurfaceCalibrationDto(
            ColorTexturePath: FindFirstByTokens(landscapeTextures, ["colormap", "colorTexture", "_cm"]),
            TileMaskPath: FindFirstByTokens(landscapeTextures, ["tilemask", "tile_mask"]),
            TileTexture0Path: FindFirstByTokens(landscapeTextures, ["tiletexture", "tiletextures", "tiletex"]),
            LandscapeTexturePaths: landscapeTextures);
    }

    private static string? FindFirstByTokens(
        IReadOnlyList<string> paths,
        IReadOnlyList<string> tokens)
    {
        return paths.FirstOrDefault(path =>
        {
            var normalized = path.ToLowerInvariant();

            return tokens.Any(token => normalized.Contains(token.ToLowerInvariant()));
        });
    }

    private static bool IsLandscapeTexture(string path)
    {
        var normalized = path.ToLowerInvariant();

        return normalized.Contains($"{Path.DirectorySeparatorChar}landscape{Path.DirectorySeparatorChar}")
            && (normalized.EndsWith(".dds.dvpl")
                || normalized.EndsWith(".pvr.dvpl")
                || normalized.EndsWith(".tex.dvpl")
                || normalized.EndsWith(".dds")
                || normalized.EndsWith(".pvr")
                || normalized.EndsWith(".tex"));
    }

    private static string ToRelativeMapPath(
        string rootDirectory,
        string path)
    {
        return Path
            .GetRelativePath(rootDirectory, path)
            .Replace('\\', '/');
    }

    private sealed record KnownMapCalibration(
        string ReplayMapName,
        float HeightScale,
        float HeightOffset,
        string HeightSource,
        float Confidence,
        bool TerrainSwapXz,
        bool TerrainFlipX,
        bool TerrainFlipZ,
        string? Note);
}