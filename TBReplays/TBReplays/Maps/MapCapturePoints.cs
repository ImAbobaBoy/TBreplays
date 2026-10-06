using System.Security.Cryptography;
using System.Text.Json;

namespace TBReplays.Maps;

public sealed record MapCapturePoint(int Id, string Label, MapObjectVector3Dto Position, float Radius,
    float CapturePoints, float PointsPerSecond, float MaxPointsPerSecond, float IncomeVictoryPoints,
    float SpawnVictoryPointsTime);
public sealed record MapCapturePointSet(string MapId, string SourceHash, string CoordinateSystem,
    IReadOnlyList<MapCapturePoint> Points);

public static class MapCapturePoints
{
    // SC2 is Z-up. Use the same world conversion as the object mesh exporter,
    // never replay calibration (which may contain user corrections).
    public static MapCapturePointSet Extract(string mapId, MapScene scene, byte[] source)
        => Extract(mapId, scene.Root, source);

    public static MapCapturePointSet Extract(string mapId, Dictionary<string, object?> root, byte[] source)
    {
        var points = new List<MapCapturePoint>();
        foreach (var entity in MapScene.ActiveEntities(root.GetValueOrDefault("#hierarchy")))
        {
            var properties = MapScene.Component(entity, "CustomPropertiesComponent")?
                .GetValueOrDefault("cpc.properties.archive") as Dictionary<string, object?>;
            if (properties?.GetValueOrDefault("type") as string != "strategicpoint") continue;
            var transform = MapScene.Component(entity, "TransformComponent");
            if (transform?.GetValueOrDefault("tc.worldTranslation") is not float[] { Length: 3 } p
                || p.Any(x => !float.IsFinite(x))) throw new InvalidDataException("Capture point transform is missing.");
            var id = checked((int)Number(properties, "baseID"));
            var radius = Number(properties, "radius");
            if (id is < 0 or > 25 || radius <= 0 || points.Any(x => x.Id == id))
                throw new InvalidDataException("Invalid or duplicate strategic point.");
            points.Add(new(id, ((char)('A' + id)).ToString(), new(p[0], p[2], -p[1]), radius,
                Number(properties,"capturePoints"), Number(properties,"pointsPerSecond"),
                Number(properties,"maxPointsPerSecond"), Number(properties,"incomeVictoryPoints"),
                Number(properties,"spawnVictoryPointsTime")));
        }
        return new(mapId, Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant(), "three-world-v1",
            points.OrderBy(x => x.Id).ToArray());
    }
    private static float Number(Dictionary<string, object?> properties, string name)
    {
        if (!properties.TryGetValue(name, out var value) || value is null) throw new InvalidDataException($"Missing {name}.");
        var number = Convert.ToSingle(value, System.Globalization.CultureInfo.InvariantCulture);
        return float.IsFinite(number) ? number : throw new InvalidDataException($"Invalid {name}.");
    }

    private static readonly Lazy<Dictionary<string, MapCapturePointSet>> Bundled = new(() => {
        using var stream = typeof(MapCapturePoints).Assembly.GetManifestResourceStream("TBReplays.SupremacyPoints")
            ?? throw new InvalidDataException("Supremacy point catalog is missing.");
        return JsonSerializer.Deserialize<Dictionary<string,MapCapturePointSet>>(stream, MapCatalogService.JsonOptions) ?? [];
    });
    public static MapCapturePointSet? GetBundled(string mapId) => Bundled.Value.GetValueOrDefault(mapId);
}
