namespace TBReplays.Replays;

public sealed record ReplayMovementImportResultDto(
    string ReplayId,
    string? MapName,
    int? MapId,
    int TrackCount,
    int SampleCount,
    string MovementsUrl);