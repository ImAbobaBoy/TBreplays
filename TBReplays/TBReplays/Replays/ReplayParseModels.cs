namespace TBReplays.Replays;

public sealed class ReplayVehicleInfo
{
    public uint EntityId { get; init; }
    public long AccountId { get; init; }
    public string Nickname { get; init; } = string.Empty;
    public int TeamId { get; init; }
    public uint VehicleCompactDescriptor { get; init; }
}

public sealed class ReplayMovementFrame
{
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int TeamId { get; init; }
    public int SegmentIndex { get; init; }

    public float X { get; init; }
    public float Y { get; init; }
    public float Z { get; init; }

    public float YawRadians { get; init; }
    public float PitchRadians { get; init; }
    public float RollRadians { get; init; }

    public bool IsVolatile { get; init; }
}

public sealed class ReplayTurretFrame
{
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public float TurretYawRadians { get; init; }
}

public sealed class ReplayShotEvent
{
    public float Time { get; init; }
    public uint ShooterEntityId { get; init; }
    public uint ProjectileId { get; init; }
    public int ShotFlags { get; init; }

    public float OriginX { get; init; }
    public float OriginY { get; init; }
    public float OriginZ { get; init; }

    public float DirectionX { get; init; }
    public float DirectionY { get; init; }
    public float DirectionZ { get; init; }
}

public sealed class ReplayProjectilePoint
{
    public float Time { get; init; }
    public uint ProjectileId { get; init; }

    public float X { get; init; }
    public float Y { get; init; }
    public float Z { get; init; }
}

public sealed class ReplayHealthFrame
{
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int Health { get; init; }
}

public sealed class ReplayParseResult
{
    public IReadOnlyList<ReplayVehicleInfo> Vehicles { get; init; } = [];
    public IReadOnlyList<ReplayMovementFrame> MovementFrames { get; init; } = [];
    public IReadOnlyList<ReplayTurretFrame> TurretFrames { get; init; } = [];
    public IReadOnlyList<ReplayShotEvent> ShotEvents { get; init; } = [];
    public IReadOnlyList<ReplayProjectilePoint> ProjectilePoints { get; init; } = [];
    public IReadOnlyList<ReplayHealthFrame> HealthFrames { get; init; } = [];
}

public sealed class ReplayParseLocalResultDto
{
    public string ReplayId { get; init; } = string.Empty;
    public int VehicleCount { get; init; }
    public int MovementFrameCount { get; init; }
    public int TurretFrameCount { get; init; }
    public int ShotEventCount { get; init; }
    public int ProjectilePointCount { get; init; }
    public int HealthFrameCount { get; init; }
    public string ParseResultUrl { get; init; } = string.Empty;
}