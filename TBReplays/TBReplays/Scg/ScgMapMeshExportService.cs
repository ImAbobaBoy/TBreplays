using System.Buffers.Binary;
using System.Numerics;
using System.Text.Json;
using TBReplays.Dvpl;
using TBReplays.Maps;
using TBReplays.Sc2;

namespace TBReplays.Scg;

public sealed class ScgMapMeshExportService
{
    private readonly DvplDecoder _decoder;
    private readonly Sc2SceneReader _scenes;
    private readonly ScgPolygonGroupReader _geometry;
    public ScgMapMeshExportService(DvplDecoder decoder, Sc2SceneReader scenes, ScgPolygonGroupReader geometry)
    { _decoder = decoder; _scenes = scenes; _geometry = geometry; }

    public Task<MapObjectMeshManifestDto> ExportAsync(string mapId, string importedDirectory, string processedDirectory, CancellationToken ct)
    {
        var files = Directory.EnumerateFiles(importedDirectory, "*.sc2*", SearchOption.AllDirectories)
            .Where(p => p.EndsWith(".sc2") || p.EndsWith(".sc2.dvpl")).ToArray();
        if (files.Length != 1) throw new InvalidDataException("Для экспорта требуется одна корневая SC2 сцена.");
        var scene = new MapScene(_scenes.Read(_decoder.DecodeFile(files[0])));
        var stem = files[0].Replace(".sc2.dvpl", "").Replace(".sc2", "");
        var scg = File.Exists(stem + ".scg.dvpl") ? stem + ".scg.dvpl" : stem + ".scg";
        return ExportSceneAsync(mapId, scene, new MapResourceResolver(Path.GetDirectoryName(files[0])!, importedDirectory, _decoder), scg, processedDirectory, ct);
    }

    public async Task<MapObjectMeshManifestDto> ExportSceneAsync(string mapName, MapScene scene, MapResourceResolver resources,
        string scgPath, string processedDirectory, CancellationToken ct)
    {
        Directory.CreateDirectory(processedDirectory);
        var groups = _geometry.Read(_decoder.DecodeFile(scgPath));
        var positions = new List<float>(); var normals = new List<float>(); var uvs = new List<float>(); var indices = new List<uint>();
        var draws = new List<(int Start, int Count, int Material)>();
        var materials = new List<MapMeshMaterialDto>(); var materialIndices = new Dictionary<ulong, int>();
        var instances = new List<MapMeshInstanceDto>(); var warnings = new HashSet<string>(StringComparer.Ordinal);
        var objects = new List<MapObjectDto>();
        var repairedNormals = new Dictionary<ulong, Vector3[]>();
        foreach (var entity in scene.Entities)
        {
            ct.ThrowIfCancellationRequested();
            var name = entity.GetValueOrDefault("name") as string ?? "object";
            var render = MapScene.RenderObject(entity);
            if (render is null || ReferenceEquals(render, scene.Landscape)) continue;
            var renderType = render.GetValueOrDefault("##name") as string ?? "";
            if (renderType.Contains("Skinned", StringComparison.OrdinalIgnoreCase))
            { warnings.Add($"{name}: SkinnedMesh требует skinning; пропущен."); continue; }
            var transform = MapScene.Component(entity, "TransformComponent") ?? throw new InvalidDataException($"{name}: нет transform.");
            var p = ReadVector(transform, "tc.worldTranslation", 3); var s = ReadVector(transform, "tc.worldScale", 3); var q = ReadVector(transform, "tc.worldRotation", 4);
            var position = new Vector3(p[0], p[1], p[2]); var scale = new Vector3(s[0], s[1], s[2]);
            var rotation = new Quaternion(q[0], q[1], q[2], q[3]);
            if (rotation.LengthSquared() < 1e-10f || MathF.Abs(scale.X * scale.Y * scale.Z) < 1e-12f)
            { warnings.Add($"{name}: вырожденный transform; пропущен."); continue; }
            rotation = Quaternion.Normalize(rotation);
            var start = indices.Count; var usedBatches = 0;
            var boundsMin = new Vector3(float.PositiveInfinity); var boundsMax = new Vector3(float.NegativeInfinity);
            foreach (var (_, batch) in MapScene.Batches(render))
            {
                var id = MapScene.Id(batch.GetValueOrDefault("rb.datasource"));
                if (!groups.TryGetValue(id, out var group)) throw new InvalidDataException($"{name}: datasource {id} отсутствует в корневом SCG.");
                if (group.PrimitiveType != 1)
                {
                    if (name.StartsWith("MapBorder", StringComparison.OrdinalIgnoreCase))
                    { warnings.Add($"{name}: служебная граница, primitiveType={group.PrimitiveType}; исключена из triangle mesh."); continue; }
                    throw new NotSupportedException($"{name}: primitiveType={group.PrimitiveType} требует преобразования топологии.");
                }
                if (group.Packing != 0 || (group.VertexFormat & 1) == 0 || group.IndexCount % 3 != 0)
                    throw new InvalidDataException($"{name}: неподдерживаемый vertex layout или некорректный triangle-list.");
                var materialId = MapScene.Id(batch.GetValueOrDefault("rb.nmatname"));
                var material = scene.Material(materialId);
                if ((material.GetValueOrDefault("fxName") as string ?? "").Contains("sky", StringComparison.OrdinalIgnoreCase))
                { warnings.Add($"{name}: sky material исключён из объектов."); continue; }
                if (!materialIndices.TryGetValue(materialId, out var materialIndex))
                {
                    materialIndex = materials.Count;
                    string? textureUrl = null;
                    var textures = material.GetValueOrDefault("textures") as Dictionary<string, object?>;
                    var albedo = textures?.GetValueOrDefault("albedo") as string ?? textures?.GetValueOrDefault("baseColor") as string;
                    if (albedo is not null)
                    {
                        try { textureUrl = $"/api/maps/{mapName}/textures/{resources.ExportTexture(albedo, processedDirectory)}"; }
                        catch (Exception e) when (e is IOException or NotSupportedException)
                        { warnings.Add($"{name}: material {materialId}, texture {albedo}: {e.Message}"); }
                    }
                    materials.Add(new(materialIndex, material.GetValueOrDefault("materialName") as string ?? materialId.ToString(), textureUrl));
                    materialIndices.Add(materialId, materialIndex);
                }
                var vertexBase = checked((uint)(positions.Count / 3));
                var hasNormal = (group.VertexFormat & 2) != 0;
                var uvOffset = 12 + (hasNormal ? 12 : 0) + ((group.VertexFormat & 4) != 0 ? 4 : 0);
                var hasUv = (group.VertexFormat & 8) != 0;
                if (group.VertexStride < uvOffset + (hasUv ? 8 : 0)) throw new InvalidDataException($"{name}: vertex stride не соответствует формату.");
                for (int i = 0; i < group.VertexCount; i++)
                {
                    var offset = i * group.VertexStride;
                    float F(int at) => BinaryPrimitives.ReadSingleLittleEndian(group.Vertices.AsSpan(offset + at, 4));
                    var local = new Vector3(F(0), F(4), F(8));
                    boundsMin = Vector3.Min(boundsMin, local); boundsMax = Vector3.Max(boundsMax, local);
                    var world = ToThree(Vector3.Transform(local * scale, rotation) + position);
                    if (!float.IsFinite(world.X) || !float.IsFinite(world.Y) || !float.IsFinite(world.Z)) throw new InvalidDataException($"{name}: non-finite vertex.");
                    positions.AddRange([world.X, world.Y, world.Z]);
                    var localNormal = hasNormal ? new Vector3(F(12), F(16), F(20)) : Vector3.Zero;
                    if (!float.IsFinite(localNormal.LengthSquared()) || localNormal.LengthSquared() < 1e-12f)
                    {
                        if (!repairedNormals.TryGetValue(group.Id, out var generated))
                            repairedNormals[group.Id] = generated = GenerateNormals(group);
                        localNormal = generated[i];
                        warnings.Add($"SCG group {group.Id}: отсутствующие или повреждённые нормали восстановлены по треугольникам.");
                    }
                    var normal = Vector3.Transform(localNormal / scale, rotation);
                    normal = ToThree(normal.LengthSquared() > 1e-12f ? Vector3.Normalize(normal) : Vector3.UnitZ);
                    normals.AddRange([normal.X, normal.Y, normal.Z]);
                    float u = hasUv ? F(uvOffset) : 0, v = hasUv ? F(uvOffset + 4) : 0;
                    if (!float.IsFinite(u) || !float.IsFinite(v)) throw new InvalidDataException($"{name}: non-finite UV.");
                    uvs.AddRange([u, v]);
                }
                uint Index(int i)
                {
                    var value = group.IndexFormat == 0 ? BinaryPrimitives.ReadUInt16LittleEndian(group.Indices.AsSpan(i * 2)) : BinaryPrimitives.ReadUInt32LittleEndian(group.Indices.AsSpan(i * 4));
                    if (value >= group.VertexCount) throw new InvalidDataException($"{name}: index {value} вне vertex buffer.");
                    return vertexBase + value;
                }
                var drawStart = indices.Count;
                for (int i = 0; i < group.IndexCount; i += 3)
                {
                    indices.Add(Index(i));
                    if (scale.X * scale.Y * scale.Z < 0) { indices.Add(Index(i + 2)); indices.Add(Index(i + 1)); }
                    else { indices.Add(Index(i + 1)); indices.Add(Index(i + 2)); }
                }
                draws.Add((drawStart, group.IndexCount, materialIndex)); usedBatches++;
            }
            if (indices.Count == start) continue;
            var entityId = checked((int)MapScene.Id(entity.GetValueOrDefault("id")));
            instances.Add(new(entityId, name, start, indices.Count - start));
            var size = boundsMax - boundsMin; var center = (boundsMin + boundsMax) / 2;
            objects.Add(new(entityId, name, "render", V(position), new(rotation.X, rotation.Y, rotation.Z, rotation.W), V(scale), V(boundsMin), V(boundsMax), V(center), V(size), usedBatches));
        }
        if (indices.Count == 0 && groups.Values.Any(g => g.PrimitiveType == 1)) throw new InvalidDataException("SCG содержит геометрию, но экспорт не выбрал ни одного triangle batch.");
        // OBJ2 schema 3: draw ranges, positions, UVs, normals, UInt32 triangle indices.
        using (var writer = new BinaryWriter(File.Create(Path.Combine(processedDirectory, "objects_mesh.bin"))))
        {
            writer.Write(0x324a424f); writer.Write(3); writer.Write(positions.Count / 3); writer.Write(indices.Count); writer.Write(draws.Count);
            foreach (var draw in draws) { writer.Write(draw.Start); writer.Write(draw.Count); writer.Write(draw.Material); }
            foreach (var value in positions) writer.Write(value);
            foreach (var value in uvs) writer.Write(value);
            foreach (var value in normals) writer.Write(value);
            foreach (var value in indices) writer.Write(value);
        }
        var manifest = new MapObjectMeshManifestDto(mapName, positions.Count / 3, indices.Count, $"/api/maps/{mapName}/object-mesh.bin", 3, materials, instances, warnings.Order().ToArray());
        var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        await File.WriteAllTextAsync(Path.Combine(processedDirectory, "objects_mesh_manifest.json"), JsonSerializer.Serialize(manifest, options), ct);
        await File.WriteAllTextAsync(Path.Combine(processedDirectory, "objects.json"), JsonSerializer.Serialize(new MapObjectSetDto(mapName, objects.Count, objects), options), ct);
        return manifest;
    }

    private static float[] ReadVector(Dictionary<string, object?> transform, string key, int count) =>
        transform.GetValueOrDefault(key) is float[] values && values.Length == count && values.All(float.IsFinite) ? values : throw new InvalidDataException($"Некорректный {key}.");
    private static Vector3 ToThree(Vector3 v) => new(v.X, v.Z, -v.Y);
    private static Vector3[] GenerateNormals(ScgPolygonGroup group)
    {
        var result = new Vector3[group.VertexCount];
        Vector3 Position(int i)
        {
            var at = i * group.VertexStride;
            return new(BinaryPrimitives.ReadSingleLittleEndian(group.Vertices.AsSpan(at)),
                BinaryPrimitives.ReadSingleLittleEndian(group.Vertices.AsSpan(at + 4)),
                BinaryPrimitives.ReadSingleLittleEndian(group.Vertices.AsSpan(at + 8)));
        }
        int Index(int i)
        {
            uint value = group.IndexFormat == 0 ? BinaryPrimitives.ReadUInt16LittleEndian(group.Indices.AsSpan(i * 2)) : BinaryPrimitives.ReadUInt32LittleEndian(group.Indices.AsSpan(i * 4));
            if (value >= group.VertexCount) throw new InvalidDataException($"SCG group {group.Id}: index вне vertex buffer.");
            return (int)value;
        }
        for (int i = 0; i < group.IndexCount; i += 3)
        {
            int a = Index(i), b = Index(i + 1), c = Index(i + 2);
            var normal = Vector3.Cross(Position(b) - Position(a), Position(c) - Position(a));
            if (!float.IsFinite(normal.LengthSquared())) throw new InvalidDataException($"SCG group {group.Id}: non-finite geometry.");
            result[a] += normal; result[b] += normal; result[c] += normal;
        }
        for (int i = 0; i < result.Length; i++) result[i] = result[i].LengthSquared() > 1e-12f ? Vector3.Normalize(result[i]) : Vector3.UnitZ;
        return result;
    }
    private static MapObjectVector3Dto V(Vector3 v) => new(v.X, v.Y, v.Z);
}
