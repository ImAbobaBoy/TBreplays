namespace TBReplays.Replays;

public static class ReplayMapMatchStatuses
{
    public const string Unknown = "unknown";
    public const string NotFound = "notFound";
    public const string Matched = "matched";
    public const string Ambiguous = "ambiguous";
}

public sealed class ReplayMapBindingDto
{
    public string? ReplayMapName { get; init; }
    public int? ReplayMapId { get; init; }
    public string? NormalizedReplayMapName { get; init; }
    public string MatchStatus { get; init; } = ReplayMapMatchStatuses.Unknown;
    public string? MatchedBackendMapId { get; init; }
    public string? MatchedMapKey { get; init; }
    public string? MatchedMapReplayName { get; init; }
    public IReadOnlyList<ReplayMapBindingCandidateDto> Candidates { get; init; } = [];
}

public sealed class ReplayMapBindingCandidateDto
{
    public string BackendMapId { get; init; } = string.Empty;
    public string MapKey { get; init; } = string.Empty;
    public string? ReplayMapName { get; init; }
    public string MatchSource { get; init; } = string.Empty;
}
