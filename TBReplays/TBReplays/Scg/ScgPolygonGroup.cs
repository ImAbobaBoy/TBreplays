namespace TBReplays.Scg;

public sealed record ScgPolygonGroup(
    ulong Id,
    int VertexCount,
    int IndexCount,
    int VertexFormat,
    int VertexStride,
    byte[] Vertices,
    byte[] Indices,
    int IndexFormat = 0,
    int PrimitiveType = 1,
    int Packing = 0);
