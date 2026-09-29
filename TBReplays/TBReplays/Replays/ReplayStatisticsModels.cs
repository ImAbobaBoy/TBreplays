namespace TBReplays.Replays;

public sealed record ReplayBattleOutcome
{
    public int? WinnerTeamId { get; init; }
    public int? FinishReasonCode { get; init; }
    public string Reason { get; init; } = "unknown";
    public string ReasonName { get; init; } = "Причина не определена";
    public string Status { get; init; } = "unknown";
    public string Source { get; init; } = "unknown";
    public float? EndTime { get; init; }
    public bool SourcesAgree { get; init; } = true;
}

public sealed record ReplayScoreEvent(float Time, int PacketIndex, int TeamId, int Points, int? Delta);
public sealed record ReplayKillEvent(float Time, int PacketIndex, uint VictimEntityId, uint? KillerEntityId);
public sealed record ReplayResultField(int Number, int WireType, string? IntegerValue, string? BytesBase64);

public sealed record ReplayVehicleStatistics
{
    public string AccountId { get; init; } = "";
    public uint VehicleCompactDescriptor { get; init; }
    public string? VehicleKey { get; init; }
    public string? Nation { get; init; }
    public string? VehicleClass { get; init; }
    public int? Level { get; init; }
    public uint EntityId { get; init; }
    public int TeamId { get; init; }
    public string Nickname { get; init; } = "";
    public string? VehicleName { get; init; }
    public int? InitialHp { get; init; }
    public int? FinalHp { get; init; }
    public bool? IsDestroyed { get; init; }
    public int? DamageDealt { get; init; }
    public int? DamageReceived { get; init; }
    public int ObservedShots { get; init; }
    public int ConfirmedKills { get; init; }
    public int MinimumConsumableUses { get; init; }
    public IReadOnlyList<ReplayExtraSummary> Extras { get; init; } = [];
    public IReadOnlyList<ReplayResultField> ResultFields { get; init; } = [];
}

public sealed record ReplayExtraSummary
{
    public int ExtraId { get; init; }
    public int? ItemId { get; init; }
    public string Key { get; init; } = "";
    public string Name { get; init; } = "";
    public string Kind { get; init; } = "unknown";
    public string? Icon { get; init; }
    public int DirectUses { get; init; }
    public int InferredUses { get; init; }
    public int MinimumUses => DirectUses + InferredUses;
    public bool UsageMayBeIncomplete { get; init; } = true;
}

public sealed record ReplayTeamStatistics
{
    public int TeamId { get; init; }
    public bool? IsWinner { get; init; }
    public int VehicleCount { get; init; }
    public int? AliveCount { get; init; }
    public int ConfirmedKills { get; init; }
    public int? InitialHp { get; init; }
    public int? FinalHp { get; init; }
    public int? DamageDealt { get; init; }
    public int? DamageReceived { get; init; }
    public int? FinalSupremacyPoints { get; init; }
}

// All times use the data.replay clock. Complete states, sorted on the server.
// The consumer selects the last frame with Time <= playbackTime; it never sums damage/points.
public sealed record ReplayPlaybackData
{
    public string TimeBasis { get; init; } = "replaySeconds";
    public float StartTime { get; init; }
    public float EndTime { get; init; }
    public IReadOnlyList<ReplayVehicleTrack> Vehicles { get; init; } = [];
    public IReadOnlyList<ReplayScoreboardFrame> Scoreboard { get; init; } = [];
    public IReadOnlyList<ReplayProjectileTrack> Projectiles { get; init; } = [];
}

public sealed record ReplayVehicleTrack
{
    public uint EntityId { get; init; }
    public int TeamId { get; init; }
    public string Nickname { get; init; } = "";
    public string? VehicleName { get; init; }
    public int? MaxHp { get; init; }
    public IReadOnlyList<ReplayMovementFrame> Movement { get; init; } = [];
    public IReadOnlyList<ReplayTurretFrame> Turret { get; init; } = [];
    public IReadOnlyList<ReplayVehicleState> States { get; init; } = [];
    public IReadOnlyList<ReplayVisibilityInterval> Visibility { get; init; } = [];
    public IReadOnlyList<ReplayConsumableActivationEvent> ConsumableUses { get; init; } = [];
    public IReadOnlyList<ReplayShotEvent> Shots { get; init; } = [];
}

public sealed record ReplayVehicleState
{
    public float Time { get; init; }
    public int? Health { get; init; }
    public double? HealthFraction { get; init; }
    public bool IsAlive { get; init; }
    public bool IsVisible { get; init; }
    public bool HealthIsLastKnown { get; init; }
    public int ObservedDamageReceived { get; init; }
    public int ConfirmedKills { get; init; }
    public IReadOnlyList<ReplayExtraStateFrame> Extras { get; init; } = [];
    public IReadOnlyList<ReplayModuleStateEvent> Modules { get; init; } = [];
}

public sealed record ReplayScoreboardFrame(float Time, IReadOnlyList<ReplayTeamState> Teams);
public sealed record ReplayTeamState(int TeamId, int AliveCount, int ConfirmedKills,
    int? InitialHp, int? LastKnownHp, bool HasUnobservedHealth, int? SupremacyPoints);
public sealed record ReplayProjectileTrack(uint ProjectileId, IReadOnlyList<ReplayProjectilePoint> Points);
