namespace TBReplays.Replays;

/// <summary>Ready-to-render contract. No legacy flat frame arrays or binary result fields.</summary>
public sealed record ReplayPresentationDto
{
    public uint? RecorderEntityId { get; init; }
    public int? RecorderTeamId { get; init; }
    public int SchemaVersion { get; init; }
    public string? ClientVersion { get; init; }
    public string? CatalogVersion { get; init; }
    public string? ArenaUniqueId { get; init; }
    public string? MapName { get; init; }
    public int? MapId { get; init; }
    public ReplayMapBindingDto MapBinding { get; init; } = new();
    public ReplayBattleOutcome Outcome { get; init; } = new();
    public IReadOnlyList<ReplayVehicleStatistics> Vehicles { get; init; } = [];
    public IReadOnlyList<ReplayTeamStatistics> Teams { get; init; } = [];
    public ReplayPlaybackData Playback { get; init; } = new();
    public IReadOnlyList<ReplayParseWarning> Warnings { get; init; } = [];

    public static ReplayPresentationDto FromResult(ReplayParseResult result) => new()
    {
        RecorderEntityId = result.RecorderEntityId, RecorderTeamId = result.RecorderTeamId,
        SchemaVersion = result.SchemaVersion, ClientVersion = result.ClientVersion,
        CatalogVersion = result.CatalogVersion, ArenaUniqueId = result.ArenaUniqueId,
        MapName = result.MapName, MapId = result.MapId, MapBinding = result.MapBinding,
        Outcome = result.Outcome, Teams = result.Teams, Playback = result.Playback,
        Vehicles = result.VehicleStatistics.Select(x => x with { ResultFields = [] }).ToArray(),
        Warnings = result.Warnings
    };
}
