using System.Text.Json;
using TBReplays.Maps.Calibration;
using TBReplays.Terrain;

namespace TBReplays.Maps;

// MapDirectoryImporter writes revisions; this service reads the published map artifacts.
public sealed class MapImportService(MapCatalogService catalog, MapCalibrationService calibration)
{
    private string DirectoryFor(string name) => catalog.GetProcessedDirectory(name);
    private string Artifact(string name, string file)
    {
        var path = Path.Combine(DirectoryFor(name), file);
        return File.Exists(path) ? path : throw new FileNotFoundException("Артефакт карты не найден. Запустите пакетный импорт.", path);
    }
    private async Task<T> Read<T>(string name, string file, CancellationToken ct)
    {
        await using var stream = File.OpenRead(Artifact(name, file));
        return await JsonSerializer.DeserializeAsync<T>(stream, MapCatalogService.JsonOptions, ct)
            ?? throw new InvalidDataException($"Повреждён {file}.");
    }
    public Task<MapManifestDto> GetManifestAsync(string name, CancellationToken ct) => Read<MapManifestDto>(name, "manifest.json", ct);
    public Task<MapObjectSetDto> GetObjectsAsync(string name, CancellationToken ct) => Read<MapObjectSetDto>(name, "objects.json", ct);
    public Task<MapObjectMeshManifestDto> GetObjectMeshManifestAsync(string name, CancellationToken ct) => Read<MapObjectMeshManifestDto>(name, "objects_mesh_manifest.json", ct);
    public Task<TerrainTextureManifestDto> GetTerrainTextureManifestAsync(string name, CancellationToken ct) => Read<TerrainTextureManifestDto>(name, "terrain_texture_manifest.json", ct);
    public Task<object> GetSurfaceAsync(string name, CancellationToken ct) => Read<object>(name, "surface_manifest.json", ct);
    public async Task<MapCapturePointSet> GetCapturePointsAsync(string name, CancellationToken ct)
    {
        var directory = DirectoryFor(name);
        if (File.Exists(Path.Combine(directory, "capture_points.json")))
            return await Read<MapCapturePointSet>(name, "capture_points.json", ct);
        var entries = await catalog.ListAsync(ct);
        var canonical = entries.FirstOrDefault(x => x.Name == name)?.Name;
        if (canonical is null && System.Text.RegularExpressions.Regex.IsMatch(name, @"-[a-f0-9]{8}$"))
            canonical = entries.FirstOrDefault(x => x.Name == name[..^9])?.Name;
        canonical ??= name;
        return MapCapturePoints.GetBundled(canonical) ?? new(canonical, "", "three-world-v1", []);
    }
    public Task<MapCalibrationDto> GetCalibrationAsync(string name, CancellationToken ct) => calibration.ReadAsync(DirectoryFor(name), ct);
    public Task<MapCalibrationDto> SaveCalibrationAsync(string name, MapCalibrationDto value, CancellationToken ct) => calibration.SaveAsync(DirectoryFor(name), value, ct);
    public string GetObjectMeshPath(string name) => Artifact(name, "objects_mesh.bin");
    public string GetTerrainTexturePath(string name) => Artifact(name, "terrain_color.dds");
    public string GetChunkPath(string name, int x, int y)
    {
        if (x < 0 || y < 0) throw new ArgumentOutOfRangeException(nameof(x));
        return Artifact(name, TerrainChunkExporter.GetChunkFileName(x, y));
    }
    public string GetTexturePath(string name, string file)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(file, @"^[a-f0-9]{24}\.dds$")) throw new ArgumentException("Некорректное имя текстуры.");
        return Artifact(name, Path.Combine("textures", file));
    }
}
