namespace TBReplays.Maps;

public sealed record TerrainTextureManifestDto(
    string MapId,
    string FileName,
    long SizeBytes,
    string Url);