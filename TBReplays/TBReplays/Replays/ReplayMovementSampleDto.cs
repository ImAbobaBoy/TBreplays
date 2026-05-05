namespace TBReplays.Replays;

public sealed record ReplayMovementSampleDto(
    double Time,
    float X,
    float Y,
    float Z,
    float YawRad,
    float YawDeg);