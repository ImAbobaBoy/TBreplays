namespace TBReplays.Maps;

public sealed record MapObjectDto(
    int Id,
    string Name,
    string Type,
    MapObjectVector3Dto Position,
    MapObjectQuaternionDto Rotation,
    MapObjectVector3Dto Scale,
    MapObjectVector3Dto LocalBoundsMin,
    MapObjectVector3Dto LocalBoundsMax,
    MapObjectVector3Dto LocalCenter,
    MapObjectVector3Dto LocalSize,
    int RenderBatchCount);