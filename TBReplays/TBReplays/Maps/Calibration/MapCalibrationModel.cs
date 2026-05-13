namespace TBReplays.Maps.Calibration;

public sealed record MapCalibrationDto(
    string MapId,
    string MapKey,
    string? ReplayMapName,
    MapCalibrationWorldDto World,
    MapCalibrationHeightDto Height,
    MapCalibrationCoordinateTransformDto TerrainTransform,
    MapCalibrationCoordinateTransformDto ReplayTransform,
    MapObjectCalibrationDto Objects,
    MapTextureCalibrationDto Texture,
    MapSurfaceCalibrationDto Surface,
    MapHeightmapStatsDto HeightmapStats);

public sealed record MapCalibrationWorldDto(
    float HorizontalHalfExtent);

public sealed record MapCalibrationHeightDto(
    float Scale,
    float Offset,
    string Source,
    float Confidence,
    string? Note);

public sealed record MapCalibrationCoordinateTransformDto(
    bool SwapXz,
    bool FlipX,
    bool FlipZ,
    float RotationDegrees);

public sealed record MapObjectCalibrationDto(
    float HeightOffset);

public sealed record MapTextureCalibrationDto(
    float RotationDegrees,
    bool FlipU,
    bool FlipV);

public sealed record MapSurfaceCalibrationDto(
    string? ColorTexturePath,
    string? TileMaskPath,
    string? TileTexture0Path,
    IReadOnlyList<string> LandscapeTexturePaths);

public sealed record MapHeightmapStatsDto(
    int Size,
    int TileSize,
    ushort RawMin,
    ushort RawMax,
    double RawP01,
    double RawP50,
    double RawP99);