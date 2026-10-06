namespace TBReplays.Replays;

public static class ReplayDerivedEventSources
{
    public const string HealthDelta = "healthDelta";
    public const string BattleResultsDestroyedAtLastMovement = "battleResultsDestroyedAtLastMovement";
}

public static class ReplayVehicleHealthSources
{
    public const string EntitySnapshot = "entitySnapshot";
    public const string None = "none";
    public const string MaxObservedHealthFrame = "maxObservedHealthFrame";
    public const string BattleResults = "battleResults";
    public const string BaseHpFallback = "baseHpFallback";
}

public static class ReplayExtraStateNames
{
    public const string Installed = "Installed";
    public const string Activated = "Activated";
    public const string Cooldown = "Cooldown";
    public const string Cleanup = "Cleanup";
    public const string Unknown = "Unknown";
}

public static class ReplayEventConfidences
{
    public const string Confirmed = "Confirmed";
    public const string Inferred = "Inferred";
    public const string Experimental = "Experimental";
}

public static class ReplayModuleStateNames
{
    public const string Damaged = "Damaged";
    public const string Destroyed = "Destroyed";
    public const string AutoRestored = "AutoRestored";
    public const string RestoredByRepairKit = "RestoredByRepairKit";
    public const string TrackTimerMarker = "TrackTimerMarker";
    public const string Unknown = "Unknown";
}

public static class ReplayModuleEventSources
{
    public const string Channel8Type20 = "channel8Type20";
    public const string Channel8Type45 = "channel8Type45";
    public const string Channel32CompactMarker = "channel32CompactMarker";
    public const string RepairKitExplicitModuleState = "repairKitExplicitModuleState";
    public const string RepairKitHeuristic = "repairKitHeuristic";
}

public static class ReplayParseWarningCodes
{
    public const string MetaJsonMissing = "metaJsonMissing";
    public const string MapNameMissing = "mapNameMissing";
    public const string BattleResultsMissing = "battleResultsMissing";
    public const string RosterVehiclesMissing = "rosterVehiclesMissing";
    public const string VehicleDescriptorNotFound = "vehicleDescriptorNotFound";
    public const string MovementFramesMissing = "movementFramesMissing";
    public const string VisibilityFramesMissing = "visibilityFramesMissing";
    public const string HealthFramesMissing = "healthFramesMissing";
    public const string EffectiveHpMissing = "effectiveHpMissing";
    public const string EffectiveHpPartial = "effectiveHpPartial";
    public const string MapBindingUnknown = "mapBindingUnknown";
    public const string MapBindingNotFound = "mapBindingNotFound";
    public const string MapBindingAmbiguous = "mapBindingAmbiguous";
}

public sealed class ReplayParseWarning
{
    public string Code { get; init; } = string.Empty;
    public string Severity { get; init; } = "warning";
    public string Message { get; init; } = string.Empty;
    public uint? EntityId { get; init; }
    public string? Value { get; init; }
}

public sealed record ReplayCapturePointEvent(float Time, int PacketIndex, int PointId, int OwnerTeamId,
    int CapturingTeamId, float Progress, string Source, string RawPayloadHex);

public sealed record ReplaySpottingCandidate(float Time, int PacketIndex, uint EntityId, int NotificationType,
    int Flags, string Source, string Confidence, string RawPayloadHex);

public sealed class ReplayTimelineSummary
{
    public int ScoreEventCount { get; init; }
    public int ConfirmedKillEventCount { get; init; }
    public float? StartTime { get; init; }
    public float? EndTime { get; init; }
    public double? BattleDuration { get; init; }
    public int VehicleCount { get; init; }
    public int MovementFrameCount { get; init; }
    public int TurretFrameCount { get; init; }
    public int ShotEventCount { get; init; }
    public int ProjectilePointCount { get; init; }
    public int HealthFrameCount { get; init; }
    public int VisibilityFrameCount { get; init; }
    public int VisibilityIntervalCount { get; init; }
    public int DamageEventCount { get; init; }
    public int DeathEventCount { get; init; }
    public int ExtraStateFrameCount { get; init; }
    public int ConsumableActivationCount { get; init; }
    public int ModuleStateEventCount { get; init; }
    public int ModuleHitSummaryEventCount { get; init; }
    public int ModuleCompactMarkerCount { get; init; }
    public int RepairedModuleCount { get; init; }
    public int EffectiveHpVehicleCount { get; init; }
    public int WarningCount { get; init; }
    public bool HasMovement { get; init; }
    public bool HasVisibility { get; init; }
    public bool HasDamage { get; init; }
    public bool HasConsumables { get; init; }
    public bool HasModuleEvents { get; init; }
}

public sealed class ReplayVehicleInfo
{
    public uint EntityId { get; init; }
    public long AccountId { get; init; }
    public string Nickname { get; init; } = string.Empty;
    public int TeamId { get; init; }
    public uint VehicleCompactDescriptor { get; init; }
    public string? VehicleKey { get; init; }
    public string? VehicleName { get; init; }
    public string? Nation { get; init; }
    public string? VehicleClass { get; init; }
    public int? Level { get; init; }
    public int? BaseHullHp { get; init; }
    public int? InitialHealth { get; init; }
    public bool InitialHealthIsExact { get; init; }
    public int? FirstObservedHealth { get; init; }
    public float? FirstObservedHealthTime { get; init; }
    public float? InitialHealthTime { get; init; }
    public int? MaxObservedHealth { get; init; }
    public int? EffectiveHp { get; init; }
    public int? ResultCurrentHp { get; init; }
    public int? ResultDamageReceived { get; init; }
    public bool? ResultDestroyed { get; init; }
    public string EffectiveHpSource { get; init; } = ReplayVehicleHealthSources.None;
    public int? EffectiveHpDeltaFromBase { get; init; }
    public double? EffectiveHpRatioToBase { get; init; }
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
    public int PacketIndex { get; init; }
    public int PacketOffset { get; init; }
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
    public int PacketIndex { get; init; }
    public string Source { get; init; } = "property";
}

public sealed class ReplayVisibilityFrame
{
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public bool IsVisible { get; init; }
}

public sealed class ReplayVisibilityInterval
{
    public uint EntityId { get; init; }
    public float StartTime { get; init; }
    public float? EndTime { get; init; }
    public bool IsOpenEnded { get; init; }
}

public sealed record ReplayExtraStateFrame
{
    public int PacketIndex { get; init; }
    public bool IsSnapshot { get; init; }
    public double TimerStamp { get; init; }
    public float Duration { get; init; }
    public float? StateStartTime { get; init; }
    public float? StateEndTime { get; init; }
    public int? ItemId { get; init; }
    public string? Icon { get; init; }
    public string Kind { get; init; } = "unknown";
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int ExtraId { get; init; }
    public string Key { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Category { get; init; } = string.Empty;
    public string SourceKind { get; init; } = string.Empty;
    public int StateCode { get; init; }
    public string State { get; init; } = ReplayExtraStateNames.Unknown;
    public bool IsConsumable { get; init; }
    public bool IsTimelineActivation { get; init; }
    public string Confidence { get; init; } = ReplayEventConfidences.Confirmed;
}

public sealed class ReplayRepairedModuleEvent
{
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int ModuleId { get; init; }
    public string ModuleKey { get; init; } = string.Empty;
    public string ModuleName { get; init; } = string.Empty;
    public string Source { get; init; } = string.Empty;
    public string Confidence { get; init; } = ReplayEventConfidences.Confirmed;
}

public sealed class ReplayConsumableActivationEvent
{
    public float? ActivationTime { get; init; }
    public string Evidence { get; init; } = "activationPacket";
    public bool ActivationTimeIsExact { get; init; }
    public float? ActiveUntil { get; init; }
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int ExtraId { get; init; }
    public string Key { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string State { get; init; } = ReplayExtraStateNames.Activated;
    public string Confidence { get; init; } = ReplayEventConfidences.Confirmed;
    public IReadOnlyList<ReplayRepairedModuleEvent> RepairedModules { get; init; } = [];
}

public sealed class ReplayModuleStateEvent
{
    public int PacketIndex { get; init; }
    public int PacketOffset { get; init; }
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int ModuleId { get; init; }
    public string ModuleKey { get; init; } = string.Empty;
    public string ModuleName { get; init; } = string.Empty;
    public int StateCode { get; init; }
    public string State { get; init; } = ReplayModuleStateNames.Unknown;
    public uint? SourceEntityId { get; init; }
    public string Source { get; init; } = string.Empty;
    public string Confidence { get; init; } = ReplayEventConfidences.Confirmed;
}

public sealed class ReplayModuleHitSummaryEvent
{
    public int PacketIndex { get; init; }
    public int PacketOffset { get; init; }
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int ModuleId { get; init; }
    public string ModuleKey { get; init; } = string.Empty;
    public string ModuleName { get; init; } = string.Empty;
    public int StateCode { get; init; }
    public string State { get; init; } = ReplayModuleStateNames.Unknown;
    public string Source { get; init; } = ReplayModuleEventSources.Channel8Type45;
    public string Confidence { get; init; } = ReplayEventConfidences.Confirmed;
}

public sealed class ReplayModuleCompactMarker
{
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int ModuleId { get; init; }
    public string ModuleKey { get; init; } = string.Empty;
    public string ModuleName { get; init; } = string.Empty;
    public int Marker { get; init; }
    public string Meaning { get; init; } = ReplayModuleStateNames.Unknown;
    public string Confidence { get; init; } = ReplayEventConfidences.Experimental;
}

public sealed class ReplayDamageEvent
{
    public float Time { get; init; }
    public uint TargetEntityId { get; init; }
    public int PreviousHealth { get; init; }
    public int NewHealth { get; init; }
    public int Damage { get; init; }
    public uint? AttackerEntityId { get; init; }
    public string Source { get; init; } = ReplayDerivedEventSources.HealthDelta;
}

public sealed class ReplayDeathEvent
{
    public uint? KillerEntityId { get; init; }
    public string Confidence { get; init; } = ReplayEventConfidences.Confirmed;
    public float Time { get; init; }
    public uint EntityId { get; init; }
    public int PreviousHealth { get; init; }
    public string Source { get; init; } = ReplayDerivedEventSources.HealthDelta;
}

public sealed class ReplayParseResult
{
    public int CapturePointProtocolVersion { get; init; }
    public IReadOnlyList<ReplayCapturePointEvent> CapturePointEvents { get; init; } = [];
    public IReadOnlyList<ReplaySpottingCandidate> SpottingCandidates { get; init; } = [];
    public int VehicleStateProtocolVersion { get; init; }
    public IReadOnlyList<ReplayReloadEvent> ReloadEvents { get; init; } = [];
    public int ShotProtocolVersion { get; init; }
    public uint? RecorderEntityId { get; init; }
    public int? RecorderTeamId { get; init; }
    public int SchemaVersion { get; init; } = 1;
    public string? CatalogVersion { get; init; }
    public string? ArenaUniqueId { get; init; }
    public ReplayBattleOutcome Outcome { get; set; } = new();
    public IReadOnlyList<ReplayScoreEvent> ScoreEvents { get; set; } = [];
    public IReadOnlyList<ReplayKillEvent> KillEvents { get; set; } = [];
    public IReadOnlyList<ReplayVehicleStatistics> VehicleStatistics { get; set; } = [];
    public IReadOnlyList<ReplayTeamStatistics> Teams { get; set; } = [];
    public IReadOnlyList<ReplayResultField> BattleResultFields { get; set; } = [];
    public ReplayPlaybackData Playback { get; set; } = new();
    public string? ClientVersion { get; init; }
    public string? ClientHash { get; init; }
    public string? MapName { get; init; }
    public int? MapId { get; init; }
    public ReplayMapBindingDto MapBinding { get; set; } = new();
    public double? BattleDuration { get; init; }
    public IReadOnlyList<ReplayVehicleInfo> Vehicles { get; init; } = [];
    public IReadOnlyList<ReplayMovementFrame> MovementFrames { get; init; } = [];
    public IReadOnlyList<ReplayTurretFrame> TurretFrames { get; init; } = [];
    public IReadOnlyList<ReplayShotEvent> ShotEvents { get; init; } = [];
    public IReadOnlyList<ReplayProjectilePoint> ProjectilePoints { get; init; } = [];
    public IReadOnlyList<ReplayHealthFrame> HealthFrames { get; init; } = [];
    public IReadOnlyList<ReplayVisibilityFrame> VisibilityFrames { get; init; } = [];
    public IReadOnlyList<ReplayVisibilityInterval> VisibilityIntervals { get; init; } = [];
    public IReadOnlyList<ReplayDamageEvent> DamageEvents { get; init; } = [];
    public IReadOnlyList<ReplayDeathEvent> DeathEvents { get; init; } = [];
    public IReadOnlyList<ReplayExtraStateFrame> ExtraStateFrames { get; init; } = [];
    public IReadOnlyList<ReplayConsumableActivationEvent> ConsumableActivationEvents { get; init; } = [];
    public IReadOnlyList<ReplayModuleStateEvent> ModuleStateEvents { get; init; } = [];
    public IReadOnlyList<ReplayModuleHitSummaryEvent> ModuleHitSummaryEvents { get; init; } = [];
    public IReadOnlyList<ReplayModuleCompactMarker> ModuleCompactMarkers { get; init; } = [];
    public IReadOnlyList<ReplayParseWarning> Warnings { get; set; } = [];
    public ReplayTimelineSummary TimelineSummary { get; set; } = new();
}

public sealed class ReplayStoredMetadata
{
    public int SchemaVersion { get; init; } = 1;
    public ReplayBattleOutcome? Outcome { get; init; }
    public IReadOnlyList<ReplayTeamStatistics> Teams { get; init; } = [];
    public string ReplayId { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string? SourceFileName { get; init; }
    public string? ClientVersion { get; init; }
    public string? MapName { get; init; }
    public int? MapId { get; init; }
    public ReplayMapBindingDto MapBinding { get; init; } = new();
    public double? BattleDuration { get; init; }
    public DateTimeOffset ImportedAtUtc { get; init; }
    public int VehicleCount { get; init; }
    public int MovementFrameCount { get; init; }
    public int TurretFrameCount { get; init; }
    public int ShotEventCount { get; init; }
    public int ProjectilePointCount { get; init; }
    public int HealthFrameCount { get; init; }
    public int VisibilityFrameCount { get; init; }
    public int VisibilityIntervalCount { get; init; }
    public int DamageEventCount { get; init; }
    public int DeathEventCount { get; init; }
    public int ExtraStateFrameCount { get; init; }
    public int ConsumableActivationCount { get; init; }
    public int ModuleStateEventCount { get; init; }
    public int ModuleHitSummaryEventCount { get; init; }
    public int ModuleCompactMarkerCount { get; init; }
    public int RepairedModuleCount { get; init; }
    public int WarningCount { get; init; }
    public string ParseResultUrl { get; init; } = string.Empty;
}

public sealed class ReplayImportBatchResultDto
{
    public IReadOnlyList<ReplayImportItemResultDto> Items { get; init; } = [];
}

public sealed class ReplayImportItemResultDto
{
    public int SchemaVersion { get; init; } = 1;
    public ReplayBattleOutcome? Outcome { get; init; }
    public IReadOnlyList<ReplayTeamStatistics> Teams { get; init; } = [];
    public string FileName { get; init; } = string.Empty;
    public bool Success { get; init; }
    public string? Error { get; init; }
    public string? ReplayId { get; init; }
    public string Title { get; init; } = string.Empty;
    public string? SourceFileName { get; init; }
    public string? ClientVersion { get; init; }
    public string? MapName { get; init; }
    public int? MapId { get; init; }
    public ReplayMapBindingDto MapBinding { get; init; } = new();
    public double? BattleDuration { get; init; }
    public DateTimeOffset ImportedAtUtc { get; init; }
    public int VehicleCount { get; init; }
    public int MovementFrameCount { get; init; }
    public int TurretFrameCount { get; init; }
    public int ShotEventCount { get; init; }
    public int ProjectilePointCount { get; init; }
    public int HealthFrameCount { get; init; }
    public int VisibilityFrameCount { get; init; }
    public int VisibilityIntervalCount { get; init; }
    public int DamageEventCount { get; init; }
    public int DeathEventCount { get; init; }
    public int ExtraStateFrameCount { get; init; }
    public int ConsumableActivationCount { get; init; }
    public int ModuleStateEventCount { get; init; }
    public int ModuleHitSummaryEventCount { get; init; }
    public int ModuleCompactMarkerCount { get; init; }
    public int RepairedModuleCount { get; init; }
    public int WarningCount { get; init; }
    public string? ParseResultUrl { get; init; }

    public static ReplayImportItemResultDto FromMetadata(
        string fileName,
        ReplayStoredMetadata metadata)
    {
        return new ReplayImportItemResultDto
        {
            FileName = fileName,
            Success = true,
            SchemaVersion = metadata.SchemaVersion,
            Outcome = metadata.Outcome,
            Teams = metadata.Teams,
            ReplayId = metadata.ReplayId,
            Title = metadata.Title,
            SourceFileName = metadata.SourceFileName,
            ClientVersion = metadata.ClientVersion,
            MapName = metadata.MapName,
            MapId = metadata.MapId,
            MapBinding = metadata.MapBinding,
            BattleDuration = metadata.BattleDuration,
            ImportedAtUtc = metadata.ImportedAtUtc,
            VehicleCount = metadata.VehicleCount,
            MovementFrameCount = metadata.MovementFrameCount,
            TurretFrameCount = metadata.TurretFrameCount,
            ShotEventCount = metadata.ShotEventCount,
            ProjectilePointCount = metadata.ProjectilePointCount,
            HealthFrameCount = metadata.HealthFrameCount,
            VisibilityFrameCount = metadata.VisibilityFrameCount,
            VisibilityIntervalCount = metadata.VisibilityIntervalCount,
            DamageEventCount = metadata.DamageEventCount,
            DeathEventCount = metadata.DeathEventCount,
            ExtraStateFrameCount = metadata.ExtraStateFrameCount,
            ConsumableActivationCount = metadata.ConsumableActivationCount,
            ModuleStateEventCount = metadata.ModuleStateEventCount,
            ModuleHitSummaryEventCount = metadata.ModuleHitSummaryEventCount,
            ModuleCompactMarkerCount = metadata.ModuleCompactMarkerCount,
            RepairedModuleCount = metadata.RepairedModuleCount,
            WarningCount = metadata.WarningCount,
            ParseResultUrl = metadata.ParseResultUrl
        };
    }

    public static ReplayImportItemResultDto Failed(
        string fileName,
        string error)
    {
        return new ReplayImportItemResultDto
        {
            FileName = fileName,
            Success = false,
            Title = Path.GetFileNameWithoutExtension(fileName),
            ImportedAtUtc = DateTimeOffset.UtcNow,
            Error = error
        };
    }
}

public sealed class ReplaySessionItemDto
{
    public int SchemaVersion { get; init; } = 1;
    public ReplayBattleOutcome? Outcome { get; init; }
    public IReadOnlyList<ReplayTeamStatistics> Teams { get; init; } = [];
    public string ReplayId { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string? SourceFileName { get; init; }
    public string? ClientVersion { get; init; }
    public string? MapName { get; init; }
    public int? MapId { get; init; }
    public ReplayMapBindingDto MapBinding { get; init; } = new();
    public double? BattleDuration { get; init; }
    public DateTimeOffset ImportedAtUtc { get; init; }
    public int WarningCount { get; init; }
    public string ParseResultUrl { get; init; } = string.Empty;

    public static ReplaySessionItemDto FromMetadata(ReplayStoredMetadata metadata)
    {
        return new ReplaySessionItemDto
        {
            SchemaVersion = metadata.SchemaVersion,
            Outcome = metadata.Outcome,
            Teams = metadata.Teams,
            ReplayId = metadata.ReplayId,
            Title = metadata.Title,
            SourceFileName = metadata.SourceFileName,
            ClientVersion = metadata.ClientVersion,
            MapName = metadata.MapName,
            MapId = metadata.MapId,
            MapBinding = metadata.MapBinding,
            BattleDuration = metadata.BattleDuration,
            ImportedAtUtc = metadata.ImportedAtUtc,
            WarningCount = metadata.WarningCount,
            ParseResultUrl = metadata.ParseResultUrl
        };
    }
}
