namespace TBReplays.Maps;

public sealed record MapImportResultDto(
    string MapId,
    string ManifestUrl,
    string CalibrationUrl);