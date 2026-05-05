using System.Buffers.Binary;
using System.Numerics;
using System.Text.Json;
using TBReplays.Dvpl;
using TBReplays.Maps;
using TBReplays.Sc2;

namespace TBReplays.Scg;

public sealed class ScgMapMeshExportService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false
    };

    private readonly DvplDecoder _dvplDecoder;
    private readonly Sc2SceneReader _sc2SceneReader;
    private readonly ScgPolygonGroupReader _polygonGroupReader;

    public ScgMapMeshExportService(
        DvplDecoder dvplDecoder,
        Sc2SceneReader sc2SceneReader,
        ScgPolygonGroupReader polygonGroupReader)
    {
        _dvplDecoder = dvplDecoder;
        _sc2SceneReader = sc2SceneReader;
        _polygonGroupReader = polygonGroupReader;
    }

    public async Task<MapObjectMeshManifestDto> ExportAsync(
        string mapId,
        string importedDirectory,
        string processedDirectory,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(processedDirectory);

        var meshPath = Path.Combine(processedDirectory, "objects_mesh.bin");
        var manifestPath = Path.Combine(processedDirectory, "objects_mesh_manifest.json");

        var sc2Paths = FindFiles(importedDirectory, "*.sc2.dvpl")
            .Concat(FindFiles(importedDirectory, "*.sc2"))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToArray();

        var scgPaths = FindFiles(importedDirectory, "*.scg.dvpl")
            .Concat(FindFiles(importedDirectory, "*.scg"))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToArray();

        if (sc2Paths.Length == 0 || scgPaths.Length == 0)
        {
            WriteMeshBinary(meshPath, [], []);

            var emptyManifest = new MapObjectMeshManifestDto(
                MapId: mapId,
                VertexCount: 0,
                IndexCount: 0,
                Url: $"/api/maps/{mapId}/object-mesh.bin");

            await WriteManifestAsync(manifestPath, emptyManifest, cancellationToken);

            return emptyManifest;
        }

        var polygonGroups = ReadAllPolygonGroups(scgPaths);

        var positions = new List<float>(2_000_000);
        var indices = new List<uint>(2_000_000);

        foreach (var sc2Path in sc2Paths)
        {
            try
            {
                var sc2Bytes = _dvplDecoder.DecodeFile(sc2Path);
                var scene = _sc2SceneReader.Read(sc2Bytes);

                AppendSceneMeshes(scene, polygonGroups, positions, indices);
            }
            catch (Exception exception)
            {
                Console.WriteLine($"[SC2] Failed to read scene '{sc2Path}': {exception.Message}");
            }
        }

        Console.WriteLine(
            $"[SCG] Exported object mesh: sc2={sc2Paths.Length}, scg={scgPaths.Length}, polygonGroups={polygonGroups.Count}, vertices={positions.Count / 3}, indices={indices.Count}");

        WriteMeshBinary(meshPath, positions, indices);

        var manifest = new MapObjectMeshManifestDto(
            MapId: mapId,
            VertexCount: positions.Count / 3,
            IndexCount: indices.Count,
            Url: $"/api/maps/{mapId}/object-mesh.bin");

        await WriteManifestAsync(manifestPath, manifest, cancellationToken);

        return manifest;
    }
    
    private IReadOnlyDictionary<ulong, ScgPolygonGroup> ReadAllPolygonGroups(
        IReadOnlyList<string> scgPaths)
    {
        var result = new Dictionary<ulong, ScgPolygonGroup>();

        foreach (var scgPath in scgPaths)
        {
            try
            {
                var scgBytes = _dvplDecoder.DecodeFile(scgPath);
                var polygonGroups = _polygonGroupReader.Read(scgBytes);

                foreach (var polygonGroup in polygonGroups.Values)
                {
                    result[polygonGroup.Id] = polygonGroup;
                }

                Console.WriteLine(
                    $"[SCG] Loaded '{scgPath}': polygonGroups={polygonGroups.Count}");
            }
            catch (Exception exception)
            {
                Console.WriteLine($"[SCG] Failed to read '{scgPath}': {exception.Message}");
            }
        }

        return result;
    }

    private static IReadOnlyList<string> FindFiles(
        string directory,
        string searchPattern)
    {
        return Directory
            .EnumerateFiles(directory, searchPattern, SearchOption.AllDirectories)
            .ToArray();
    }

    private static void AppendSceneMeshes(
        Dictionary<string, object?> scene,
        IReadOnlyDictionary<ulong, ScgPolygonGroup> polygonGroups,
        List<float> positions,
        List<uint> indices)
    {
        if (!scene.TryGetValue("#hierarchy", out var hierarchy))
        {
            return;
        }

        foreach (var entity in EnumerateEntities(hierarchy))
        {
            var transform = FindComponent(entity, "TransformComponent");
            var render = FindComponent(entity, "RenderComponent");

            if (transform is null || render is null)
            {
                continue;
            }

            if (!TryReadVector3(transform, "tc.worldTranslation", out var translation))
            {
                continue;
            }

            if (!TryReadVector4(transform, "tc.worldRotation", out var rotation))
            {
                continue;
            }

            if (!TryReadVector3(transform, "tc.worldScale", out var scale))
            {
                scale = [1f, 1f, 1f];
            }

            var entityName = TryGetString(entity, "name")
                             ?? TryGetString(entity, "##name")
                             ?? string.Empty;

            var isImportantMapObject = IsImportantMapObject(entityName);

            if (!PassObjectFilter(entityName, render, scale, translation))
            {
                continue;
            }

            var dataSourceIds = ReadLod0DataSourceIds(render, isImportantMapObject);

            if (dataSourceIds.Count == 0)
            {
                continue;
            }
            
            if (isImportantMapObject)
            {
                Console.WriteLine(
                    $"[SCG] Important object included: '{entityName}', datasources={dataSourceIds.Count}");
            }

            var position = new Vector3(translation[0], translation[1], translation[2]);
            var scaleVector = new Vector3(scale[0], scale[1], scale[2]);

            var quaternion = new Quaternion(
                rotation[0],
                rotation[1],
                rotation[2],
                rotation[3]);

            quaternion = Quaternion.Normalize(quaternion);

            foreach (var dataSourceId in dataSourceIds)
            {
                if (!polygonGroups.TryGetValue(dataSourceId, out var polygonGroup))
                {
                    continue;
                }

                AppendPolygonGroup(
                    polygonGroup,
                    position,
                    scaleVector,
                    quaternion,
                    positions,
                    indices);
            }
        }
    }

    private static void AppendPolygonGroup(
        ScgPolygonGroup polygonGroup,
        Vector3 translation,
        Vector3 scale,
        Quaternion rotation,
        List<float> positions,
        List<uint> indices)
    {
        var vertexBase = checked((uint)(positions.Count / 3));

        for (var i = 0; i < polygonGroup.VertexCount; i++)
        {
            var vertexOffset = i * polygonGroup.VertexStride;

            var local = new Vector3(
                BinaryPrimitives.ReadSingleLittleEndian(polygonGroup.Vertices.AsSpan(vertexOffset, 4)),
                BinaryPrimitives.ReadSingleLittleEndian(polygonGroup.Vertices.AsSpan(vertexOffset + 4, 4)),
                BinaryPrimitives.ReadSingleLittleEndian(polygonGroup.Vertices.AsSpan(vertexOffset + 8, 4)));

            var scaled = local * scale;
            var world = Vector3.Transform(scaled, rotation) + translation;
            var three = BlitzWorldToThree(world);

            positions.Add(three.X);
            positions.Add(three.Y);
            positions.Add(three.Z);
        }

        for (var i = 0; i < polygonGroup.IndexCount; i++)
        {
            var indexOffset = i * sizeof(ushort);

            var sourceIndex = BinaryPrimitives.ReadUInt16LittleEndian(
                polygonGroup.Indices.AsSpan(indexOffset, 2));

            if (sourceIndex >= polygonGroup.VertexCount)
            {
                continue;
            }

            indices.Add(vertexBase + sourceIndex);
        }
    }

    private static Vector3 BlitzWorldToThree(Vector3 value)
    {
        // Blitz: X/Y — горизонтальная плоскость, Z — высота.
        // Three: X/Z — горизонтальная плоскость, Y — высота.
        return new Vector3(
            value.X,
            value.Z,
            -value.Y);
    }

    private static List<ulong> ReadLod0DataSourceIds(
        Dictionary<string, object?> render,
        bool forceImportantObject)
    {
        var result = new List<ulong>();

        if (!render.TryGetValue("rc.renderObj", out var renderObjectValue) ||
            renderObjectValue is not Dictionary<string, object?> renderObject)
        {
            return result;
        }

        var renderObjectName = TryGetString(renderObject, "##name");

        if (!forceImportantObject &&
            !string.IsNullOrWhiteSpace(renderObjectName) &&
            renderObjectName.Contains("Skinned", StringComparison.OrdinalIgnoreCase))
        {
            return result;
        }

        if (!renderObject.TryGetValue("ro.batches", out var batchesValue) ||
            batchesValue is not Dictionary<string, object?> batches)
        {
            return result;
        }

        foreach (var (batchKey, batchValue) in batches)
        {
            if (batchValue is not Dictionary<string, object?> batch)
            {
                continue;
            }

            if (!forceImportantObject && int.TryParse(batchKey, out var batchIndex))
            {
                var lodKey = $"rb{batchIndex}.lodIndex";

                if (TryGetInt32(renderObject, lodKey, out var lodIndex) && lodIndex != 0)
                {
                    continue;
                }
            }

            if (!TryGetUInt64(batch, "rb.datasource", out var dataSourceId))
            {
                continue;
            }

            result.Add(dataSourceId);
        }

        return result;
    }

    private static bool PassObjectFilter(
        string entityName,
        Dictionary<string, object?> render,
        float[] scale,
        float[] position)
    {
        if (!TryReadRenderBounds(render, out var boundsMin, out var boundsMax))
        {
            return false;
        }

        var localSize = new[]
        {
            boundsMax[0] - boundsMin[0],
            boundsMax[1] - boundsMin[1],
            boundsMax[2] - boundsMin[2]
        };

        var scaledSizeX = MathF.Abs(localSize[0] * scale[0]);
        var scaledSizeY = MathF.Abs(localSize[1] * scale[1]);
        var scaledSizeZ = MathF.Abs(localSize[2] * scale[2]);

        var maxScaledSize = MathF.Max(
            scaledSizeX,
            MathF.Max(scaledSizeY, scaledSizeZ));

        var maxHorizontalSize = MathF.Max(scaledSizeX, scaledSizeY);
        var minHorizontalSize = MathF.Min(scaledSizeX, scaledSizeY);
        var horizontalArea = scaledSizeX * scaledSizeY;

        if (maxScaledSize < 0.35f)
        {
            return false;
        }

        if (!IsReasonableMapPosition(position))
        {
            return false;
        }

        if (IsImportantMapObject(entityName))
        {
            return true;
        }

        if (maxScaledSize > 900f)
        {
            return false;
        }

        if (maxHorizontalSize > 700f && minHorizontalSize > 450f)
        {
            return false;
        }

        if (horizontalArea > 180000f)
        {
            return false;
        }

        return true;
    }
    
    private static bool IsImportantMapObject(string entityName)
    {
        if (string.IsNullOrWhiteSpace(entityName))
        {
            return false;
        }

        var name = entityName.ToLowerInvariant();

        return name.Contains("bld_")
               || name.Contains("house")
               || name.Contains("barn")
               || name.Contains("church")
               || name.Contains("bunker")
               || name.Contains("bridge")
               || name.Contains("hangar")
               || name.Contains("heinkel")
               || name.Contains("plane")
               || name.Contains("airplane")
               || name.Contains("destroy")
               || name.Contains("destr")
               || name.Contains("ruin");
    }

    private static bool IsReasonableMapPosition(float[] position)
    {
        // Для обычных игровых объектов держим поле карты + небольшой запас.
        // Очень далёкие lightning/cloud/vista plane должны отсеиваться.
        return MathF.Abs(position[0]) <= 700f
               && MathF.Abs(position[1]) <= 700f
               && position[2] >= -100f
               && position[2] <= 500f;
    }

    private static bool TryReadRenderBounds(
        Dictionary<string, object?> render,
        out float[] boundsMin,
        out float[] boundsMax)
    {
        boundsMin = [float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity];
        boundsMax = [float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity];

        if (!render.TryGetValue("rc.renderObj", out var renderObjectValue) ||
            renderObjectValue is not Dictionary<string, object?> renderObject)
        {
            return false;
        }

        if (!renderObject.TryGetValue("ro.batches", out var batchesValue) ||
            batchesValue is not Dictionary<string, object?> batches)
        {
            return false;
        }

        var count = 0;

        foreach (var batchValue in batches.Values)
        {
            if (batchValue is not Dictionary<string, object?> batch)
            {
                continue;
            }

            if (!batch.TryGetValue("rb.aabbox", out var aabbValue) ||
                aabbValue is not Sc2AabBox aabb)
            {
                continue;
            }

            for (var i = 0; i < 3; i++)
            {
                boundsMin[i] = MathF.Min(boundsMin[i], aabb.Min[i]);
                boundsMax[i] = MathF.Max(boundsMax[i], aabb.Max[i]);
            }

            count++;
        }

        return count > 0
            && IsFinite(boundsMin)
            && IsFinite(boundsMax)
            && boundsMax[0] > boundsMin[0]
            && boundsMax[1] > boundsMin[1]
            && boundsMax[2] > boundsMin[2];
    }

    private static IEnumerable<Dictionary<string, object?>> EnumerateEntities(object? value)
    {
        if (value is Dictionary<string, object?> entity)
        {
            yield return entity;

            if (entity.TryGetValue("#hierarchy", out var children))
            {
                foreach (var child in EnumerateEntities(children))
                {
                    yield return child;
                }
            }

            yield break;
        }

        if (value is List<object?> list)
        {
            foreach (var item in list)
            {
                foreach (var child in EnumerateEntities(item))
                {
                    yield return child;
                }
            }
        }
    }

    private static Dictionary<string, object?>? FindComponent(
        Dictionary<string, object?> entity,
        string componentType)
    {
        if (!entity.TryGetValue("components", out var componentsValue) ||
            componentsValue is not Dictionary<string, object?> components)
        {
            return null;
        }

        foreach (var value in components.Values)
        {
            if (value is not Dictionary<string, object?> component)
            {
                continue;
            }

            var currentType = TryGetString(component, "comp.typename");

            if (string.Equals(currentType, componentType, StringComparison.OrdinalIgnoreCase))
            {
                return component;
            }
        }

        return null;
    }

    private static bool TryReadVector3(
        Dictionary<string, object?> dictionary,
        string key,
        out float[] value)
    {
        value = [];

        if (!dictionary.TryGetValue(key, out var raw))
        {
            return false;
        }

        if (raw is not float[] vector || vector.Length < 3)
        {
            return false;
        }

        value = vector;

        return IsFinite(value);
    }

    private static bool TryReadVector4(
        Dictionary<string, object?> dictionary,
        string key,
        out float[] value)
    {
        value = [];

        if (!dictionary.TryGetValue(key, out var raw))
        {
            return false;
        }

        if (raw is not float[] vector || vector.Length < 4)
        {
            return false;
        }

        value = vector;

        return IsFinite(value);
    }

    private static bool TryGetInt32(
        Dictionary<string, object?> dictionary,
        string key,
        out int value)
    {
        value = 0;

        if (!dictionary.TryGetValue(key, out var raw))
        {
            return false;
        }

        switch (raw)
        {
            case int intValue:
                value = intValue;
                return true;

            case uint uintValue when uintValue <= int.MaxValue:
                value = (int)uintValue;
                return true;

            default:
                return false;
        }
    }

    private static bool TryGetUInt64(
        Dictionary<string, object?> dictionary,
        string key,
        out ulong value)
    {
        value = 0;

        if (!dictionary.TryGetValue(key, out var raw))
        {
            return false;
        }

        switch (raw)
        {
            case int intValue when intValue >= 0:
                value = (ulong)intValue;
                return true;

            case uint uintValue:
                value = uintValue;
                return true;

            case long longValue when longValue >= 0:
                value = (ulong)longValue;
                return true;

            case ulong ulongValue:
                value = ulongValue;
                return true;

            default:
                return false;
        }
    }

    private static string? TryGetString(
        Dictionary<string, object?> dictionary,
        string key)
    {
        return dictionary.TryGetValue(key, out var value)
            ? value as string
            : null;
    }

    private static bool IsFinite(float[] values)
    {
        return values.All(x => !float.IsNaN(x) && !float.IsInfinity(x));
    }

    private static void WriteMeshBinary(
        string path,
        IReadOnlyList<float> positions,
        IReadOnlyList<uint> indices)
    {
        using var fileStream = File.Create(path);
        using var writer = new BinaryWriter(fileStream);

        var vertexCount = positions.Count / 3;
        var indexCount = indices.Count;

        writer.Write(vertexCount);
        writer.Write(indexCount);

        foreach (var position in positions)
        {
            writer.Write(position);
        }

        foreach (var index in indices)
        {
            writer.Write(index);
        }
    }

    private static async Task WriteManifestAsync(
        string path,
        MapObjectMeshManifestDto manifest,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(manifest, JsonOptions);

        await File.WriteAllTextAsync(path, json, cancellationToken);
    }
}