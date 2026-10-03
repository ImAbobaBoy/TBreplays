using System.Buffers.Binary;
using System.Numerics;
using TBReplays.Sc2;

namespace TBReplays.Maps;

/// <summary>One parsed root scene shared by terrain, object metadata and mesh export.</summary>
public sealed class MapScene
{
    public Dictionary<string, object?> Root { get; }
    public IReadOnlyList<Dictionary<string, object?>> Entities { get; }
    public Dictionary<string, object?> Landscape { get; }
    public Dictionary<string, object?> LandscapeEntity { get; }
    public float[] Bounds { get; }
    public string HeightmapReference => (string)Landscape["hmap"]!;
    private readonly Dictionary<ulong, Dictionary<string, object?>> _materials;

    public MapScene(Dictionary<string, object?> root)
    {
        Root = root;
        Entities = ActiveEntities(root.GetValueOrDefault("#hierarchy")).ToArray();
        var landscapes = Entities.Select(e => (entity: e, render: RenderObject(e)))
            .Where(x => x.render?.GetValueOrDefault("##name") as string == "Landscape").ToArray();
        if (landscapes.Length != 1) throw new InvalidDataException($"Ожидался один Landscape, найдено {landscapes.Length}.");
        LandscapeEntity = landscapes[0].entity;
        Landscape = landscapes[0].render!;
        Bounds = Landscape.GetValueOrDefault("bbox") switch
        {
            byte[] { Length: 24 } b => Enumerable.Range(0, 6).Select(i => BinaryPrimitives.ReadSingleLittleEndian(b.AsSpan(i * 4, 4))).ToArray(),
            Sc2AabBox box => box.Min.Concat(box.Max).ToArray(),
            _ => throw new InvalidDataException("Landscape.bbox отсутствует или повреждён.")
        };
        if (Bounds.Any(x => !float.IsFinite(x)) || Enumerable.Range(0, 3).Any(i => Bounds[i + 3] <= Bounds[i]))
            throw new InvalidDataException("Некорректный Landscape.bbox.");
        var t = Component(LandscapeEntity, "TransformComponent");
        // The current terrain wire format cannot represent arbitrary Landscape transforms.
        if (t is null || !Vector(t, "tc.worldTranslation", [0, 0, 0]) || !Vector(t, "tc.worldScale", [1, 1, 1]) ||
            (!Vector(t, "tc.worldRotation", [0, 0, 0, 1]) && !Vector(t, "tc.worldRotation", [0, 0, 0, -1])))
            throw new NotSupportedException("Landscape transform требует отдельного world matrix; импорт не будет искажать рельеф.");
        _materials = new();
        foreach (var material in root.GetValueOrDefault("#dataNodes") as List<object?> ?? [])
        {
            if (material is not Dictionary<string, object?> d || d.GetValueOrDefault("##name") as string != "NMaterial") continue;
            var id = Id(d.GetValueOrDefault("#id"));
            if (!_materials.TryAdd(id, d)) throw new InvalidDataException($"Повтор material id {id}.");
        }
    }

    public Dictionary<string, object?> Material(ulong id)
    {
        var visited = new HashSet<ulong>();
        Dictionary<string, object?> Resolve(ulong key)
        {
            if (!visited.Add(key)) throw new InvalidDataException($"Цикл материалов: {key}.");
            if (!_materials.TryGetValue(key, out var local)) throw new InvalidDataException($"Не найден material id {key}.");
            var result = local.TryGetValue("parentMaterialKey", out var parent) ? Resolve(Id(parent)) : new Dictionary<string, object?>();
            foreach (var (name, value) in local)
            {
                if (value is Dictionary<string, object?> values && result.GetValueOrDefault(name) is Dictionary<string, object?> inherited)
                {
                    var merged = new Dictionary<string, object?>(inherited);
                    foreach (var pair in values) merged[pair.Key] = pair.Value;
                    result[name] = merged;
                }
                else result[name] = value;
            }
            return result;
        }
        return Resolve(id);
    }

    public static Dictionary<string, object?>? Component(Dictionary<string, object?> entity, string type) =>
        (entity.GetValueOrDefault("components") as Dictionary<string, object?>)?.Values.OfType<Dictionary<string, object?>>()
        .FirstOrDefault(x => x.GetValueOrDefault("comp.typename") as string == type);
    public static Dictionary<string, object?>? RenderObject(Dictionary<string, object?> entity) =>
        Component(entity, "RenderComponent")?.GetValueOrDefault("rc.renderObj") as Dictionary<string, object?>;

    public static IEnumerable<Dictionary<string, object?>> ActiveEntities(object? node)
    {
        if (node is List<object?> list) { foreach (var item in list) foreach (var child in ActiveEntities(item)) yield return child; yield break; }
        if (node is not Dictionary<string, object?> entity) yield break;
        yield return entity;
        var state = Component(entity, "StateSwitcherComponent");
        var children = entity.GetValueOrDefault("#hierarchy") switch
        {
            List<object?> values => values,
            Dictionary<string, object?> child => new List<object?> { child },
            _ => new List<object?>()
        };
        var stateNames = state?.Where(x => System.Text.RegularExpressions.Regex.IsMatch(x.Key, @"^ssc\.state\d+$"))
            .Select(x => x.Value as string).ToHashSet(StringComparer.Ordinal) ?? [];
        var activeName = state?.GetValueOrDefault($"ssc.state{Convert.ToInt32(state.GetValueOrDefault("ssc.activeState"))}") as string;
        if (stateNames.Count > 0 && activeName is null) throw new InvalidDataException("Не определено активное состояние StateSwitcher.");
        foreach (var child in children)
        {
            var name = (child as Dictionary<string, object?>)?.GetValueOrDefault("name") as string;
            if (stateNames.Contains(name) && name != activeName) continue;
            foreach (var descendant in ActiveEntities(child)) yield return descendant;
        }
    }

    public static IEnumerable<(int Index, Dictionary<string, object?> Batch)> Batches(Dictionary<string, object?> render)
    {
        if (render.GetValueOrDefault("ro.batches") is not Dictionary<string, object?> batches) yield break;
        var parsed = batches.Where(p => p.Value is Dictionary<string, object?> && int.TryParse(p.Key, out _))
            .Select(p => (Index: int.Parse(p.Key), Batch: (Dictionary<string, object?>)p.Value!)).ToArray();
        int Lod(int i) => Convert.ToInt32(render.GetValueOrDefault($"rb{i}.lodIndex") ?? -1);
        var selectedLod = parsed.Select(p => Lod(p.Index)).Where(x => x >= 0).DefaultIfEmpty(0).Min();
        foreach (var pair in parsed)
        {
            if (Lod(pair.Index) >= 0 && Lod(pair.Index) != selectedLod) continue;
            var switchIndex = Convert.ToInt32(render.GetValueOrDefault($"rb{pair.Index}.switchIndex") ?? -1);
            var activeSwitch = Convert.ToInt32(render.GetValueOrDefault("ro.switchIndex") ?? 0);
            if (switchIndex >= 0 && switchIndex != activeSwitch) continue;
            yield return pair;
        }
    }

    public static ulong Id(object? value) => value switch
    {
        byte[] { Length: 8 } b => BinaryPrimitives.ReadUInt64LittleEndian(b),
        uint u => u, ulong u => u, int i when i >= 0 => (ulong)i, long l when l >= 0 => (ulong)l,
        _ => throw new InvalidDataException("Некорректная ссылка на ресурс сцены.")
    };
    private static bool Vector(Dictionary<string, object?> t, string key, float[] expected) =>
        t.GetValueOrDefault(key) is float[] actual && actual.Length == expected.Length && actual.Zip(expected).All(p => MathF.Abs(p.First - p.Second) < 1e-5f);
}
