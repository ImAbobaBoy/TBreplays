using System.Text.Json.Nodes;

namespace TBReplays.Strategies;

public sealed record StrategySlideDto(
    string Id,
    string MapId,
    string Title,
    JsonNode? Snapshot,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    long Revision);

public sealed record CreateStrategySlideRequest(
    string MapId,
    string Title);
