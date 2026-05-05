namespace TBReplays.Replays;

public sealed record ReplayMovementSetDto(
    string ReplayId,
    string? MapName,
    int? MapId,
    double? BattleDuration,
    int TrackCount,
    int SampleCount,
    IReadOnlyList<ReplayMovementTrackDto> Tracks);