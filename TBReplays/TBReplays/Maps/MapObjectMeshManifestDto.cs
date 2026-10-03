namespace TBReplays.Maps;

public sealed record MapObjectMeshManifestDto(
    string MapId,
    int VertexCount,
    int IndexCount,
    string Url,
    int SchemaVersion = 1,
    IReadOnlyList<MapMeshMaterialDto>? Materials = null,
    IReadOnlyList<MapMeshInstanceDto>? Instances = null,
    IReadOnlyList<string>? Warnings = null);

public sealed record MapMeshMaterialDto(int Index, string Name, string? TextureUrl);
public sealed record MapMeshInstanceDto(int EntityId, string Name, int StartIndex, int IndexCount);
