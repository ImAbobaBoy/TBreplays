using TBReplays.Maps;

namespace TBReplays.Sc2;

public sealed class Sc2MapObjectExtractor
{
    private readonly Sc2SceneReader _sceneReader;

    public Sc2MapObjectExtractor(Sc2SceneReader sceneReader)
    {
        _sceneReader = sceneReader;
    }

    public MapObjectSetDto Extract(string mapId, byte[] sc2Bytes)
    {
        var scene = _sceneReader.Read(sc2Bytes);
        var objects = new List<MapObjectDto>();

        if (!scene.TryGetValue("#hierarchy", out var hierarchy))
        {
            return new MapObjectSetDto(mapId, 0, objects);
        }

        var nextId = 1;

        foreach (var entity in EnumerateEntities(hierarchy))
        {
            var transform = FindComponent(entity, "TransformComponent");
            var render = FindComponent(entity, "RenderComponent");

            if (transform is null || render is null)
            {
                continue;
            }

            if (!TryReadVector3(transform, "tc.worldTranslation", out var position))
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

            if (!TryReadRenderBounds(render, out var boundsMin, out var boundsMax, out var batchCount))
            {
                continue;
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
                continue;
            }

            // Слишком огромные proxy почти всегда не отдельные дома/камни,
            // а крупные батчи сцены, collision/decal/water/terrain-подобные зоны.
            if (maxScaledSize > 140f)
            {
                continue;
            }

            // Большая широкая плита. Реальные мосты/заборы обычно длинные, но узкие,
            // поэтому режем именно объекты, большие сразу по двум горизонтальным осям.
            if (maxHorizontalSize > 75f && minHorizontalSize > 28f)
            {
                continue;
            }

            // Ещё один предохранитель от огромных агрегированных батчей.
            if (horizontalArea > 2200f)
            {
                continue;
            }

            if (MathF.Abs(position[0]) > 1000f ||
                MathF.Abs(position[1]) > 1000f ||
                position[2] < -100f ||
                position[2] > 300f)
            {
                continue;
            }

            var localCenter = new[]
            {
                (boundsMin[0] + boundsMax[0]) * 0.5f,
                (boundsMin[1] + boundsMax[1]) * 0.5f,
                (boundsMin[2] + boundsMax[2]) * 0.5f
            };

            var objectName = TryGetString(entity, "name") ?? "object";

            objects.Add(new MapObjectDto(
                Id: nextId++,
                Name: objectName,
                Type: "render",
                Position: ToVector3(position),
                Rotation: ToQuaternion(rotation),
                Scale: ToVector3(scale),
                LocalBoundsMin: ToVector3(boundsMin),
                LocalBoundsMax: ToVector3(boundsMax),
                LocalCenter: ToVector3(localCenter),
                LocalSize: ToVector3(localSize),
                RenderBatchCount: batchCount));
        }

        return new MapObjectSetDto(
            MapId: mapId,
            Count: objects.Count,
            Objects: objects);
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
        if (!entity.TryGetValue("components", out var componentsValue))
        {
            return null;
        }

        if (componentsValue is not Dictionary<string, object?> components)
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

    private static bool TryReadRenderBounds(
        Dictionary<string, object?> render,
        out float[] boundsMin,
        out float[] boundsMax,
        out int batchCount)
    {
        boundsMin = [float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity];
        boundsMax = [float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity];
        batchCount = 0;

        if (!render.TryGetValue("rc.renderObj", out var renderObjectValue))
        {
            return false;
        }

        if (renderObjectValue is not Dictionary<string, object?> renderObject)
        {
            return false;
        }

        if (!renderObject.TryGetValue("ro.batches", out var batchesValue))
        {
            return false;
        }

        if (batchesValue is not Dictionary<string, object?> batches)
        {
            return false;
        }

        foreach (var batchValue in batches.Values)
        {
            if (batchValue is not Dictionary<string, object?> batch)
            {
                continue;
            }

            if (!batch.TryGetValue("rb.aabbox", out var aabbValue))
            {
                continue;
            }

            if (aabbValue is not Sc2AabBox aabb)
            {
                continue;
            }

            for (var i = 0; i < 3; i++)
            {
                boundsMin[i] = MathF.Min(boundsMin[i], aabb.Min[i]);
                boundsMax[i] = MathF.Max(boundsMax[i], aabb.Max[i]);
            }

            batchCount++;
        }

        return batchCount > 0
            && IsFinite(boundsMin)
            && IsFinite(boundsMax)
            && boundsMax[0] > boundsMin[0]
            && boundsMax[1] > boundsMin[1]
            && boundsMax[2] > boundsMin[2];
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

    private static MapObjectVector3Dto ToVector3(float[] value)
    {
        return new MapObjectVector3Dto(value[0], value[1], value[2]);
    }

    private static MapObjectQuaternionDto ToQuaternion(float[] value)
    {
        return new MapObjectQuaternionDto(value[0], value[1], value[2], value[3]);
    }
}