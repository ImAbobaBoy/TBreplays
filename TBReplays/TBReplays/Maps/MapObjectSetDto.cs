namespace TBReplays.Maps;

public sealed record MapObjectSetDto(
    string MapId,
    int Count,
    IReadOnlyList<MapObjectDto> Objects);