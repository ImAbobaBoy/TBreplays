namespace TBReplays.Maps;

public sealed record MapObjectMeshManifestDto(
    string MapId,
    int VertexCount,
    int IndexCount,
    string Url);