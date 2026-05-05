namespace TBReplays.Replays;

public sealed record ReplayMovementTrackDto(
    long EntityId,
    string EntityHex,
    int SamplesCount,
    double FirstTime,
    double LastTime,
    IReadOnlyList<ReplayMovementSampleDto> Samples);