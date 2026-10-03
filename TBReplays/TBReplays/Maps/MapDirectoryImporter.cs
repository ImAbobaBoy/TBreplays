using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using TBReplays.Dvpl;
using TBReplays.Maps.Calibration;
using TBReplays.Sc2;
using TBReplays.Scg;
using TBReplays.Terrain;

namespace TBReplays.Maps;

public sealed class MapDirectoryImporter
{
    public const int PipelineVersion = 5;
    private readonly IWebHostEnvironment _env;
    private readonly MapImportOptions _options;
    private readonly DvplDecoder _decoder;
    private readonly Sc2SceneReader _reader;
    private readonly TerrainChunkExporter _terrain;
    private readonly ScgMapMeshExportService _mesh;
    private readonly MapCatalogService _catalog;
    private readonly MapCalibrationService _calibration;
    private IReadOnlyList<(string Alias, string Path, string Title)>? _mapNames;
    private Task<byte[]>? _sharedFingerprint;
    private readonly object _fingerprintGate = new();

    public MapDirectoryImporter(IWebHostEnvironment env, IOptions<MapImportOptions> options, DvplDecoder decoder,
        Sc2SceneReader reader, TerrainChunkExporter terrain, ScgMapMeshExportService mesh, MapCatalogService catalog, MapCalibrationService calibration)
    {
        _env = env; _options = options.Value; _decoder = decoder; _reader = reader; _terrain = terrain; _mesh = mesh; _catalog = catalog; _calibration = calibration;
        var source = SourceRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var data = DataRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (source.Equals(data, StringComparison.OrdinalIgnoreCase) ||
            data.StartsWith(source + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
            source.StartsWith(data + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Каталоги исходных карт и результатов не должны совпадать или быть вложены друг в друга. Исходники доступны только для чтения.");
    }

    public string SourceRoot => Path.GetFullPath(_options.SourceDirectory, _env.ContentRootPath);
    public int MaxParallelMaps => Math.Clamp(_options.MaxParallelMaps, 1, 4);
    public string DataRoot => _catalog.DataRoot;
    public void EnsureFreeSpace()
    {
        if (!double.IsFinite(_options.MinimumFreeSpaceGiB) || _options.MinimumFreeSpaceGiB < 0)
            throw new InvalidOperationException("MinimumFreeSpaceGiB должен быть конечным неотрицательным числом.");
        var drive = new DriveInfo(Path.GetPathRoot(DataRoot)!);
        if (drive.AvailableFreeSpace < _options.MinimumFreeSpaceGiB * 1024 * 1024 * 1024)
            throw new IOException($"Недостаточно места для импорта на {drive.Name}: свободно {drive.AvailableFreeSpace / 1073741824d:F2} ГиБ, резерв {_options.MinimumFreeSpaceGiB:F2} ГиБ. Каталог: {DataRoot}.");
    }
    public async Task PrepareBatchAsync(CancellationToken ct)
    {
        lock (_fingerprintGate) _sharedFingerprint = SharedFingerprintAsync(ct);
        await _sharedFingerprint;
        _mapNames = null;
        _ = GetNames("");
    }
    public string[] Discover()
    {
        if (!Directory.Exists(SourceRoot)) throw new DirectoryNotFoundException($"Каталог карт отсутствует: {SourceRoot}");
        return Directory.EnumerateDirectories(SourceRoot).Where(d =>
        {
            var name = Path.GetFileName(d);
            return Regex.IsMatch(name, @"^(?!00_)\d{2}_[a-z0-9_]+$") &&
                (File.Exists(Path.Combine(d, name + ".sc2.dvpl")) || File.Exists(Path.Combine(d, name + ".sc2")));
        }).OrderBy(Path.GetFileName, StringComparer.Ordinal).ToArray();
    }

    public async Task<MapImportItem> ImportAsync(string directory, bool force, CancellationToken ct)
    {
        var clock = Stopwatch.StartNew();
        var name = Path.GetFileName(directory); MapCatalogService.ValidateName(name);
        string? staging = null;
        try
        {
            var sourceHash = await FingerprintAsync(directory, ct);
            var previous = (await _catalog.ListAsync(ct)).SingleOrDefault(x => x.Name == name);
            if (!force && previous?.SourceHash == sourceHash && previous.PipelineVersion == PipelineVersion && File.Exists(Path.Combine(_catalog.GetProcessedDirectory(name), "manifest.json")))
                return new(name, "unchanged", null, clock.ElapsedMilliseconds, previous.Warnings);
            var revision = sourceHash[..20] + "-" + Guid.NewGuid().ToString("N")[..8];
            EnsureFreeSpace();
            var revisions = Path.Combine(DataRoot, "Processed", name, "revisions");
            Directory.CreateDirectory(revisions);
            staging = Path.Combine(revisions, "staging-" + revision); Directory.CreateDirectory(staging);
            var rootFile = File.Exists(Path.Combine(directory, name + ".sc2.dvpl")) ? Path.Combine(directory, name + ".sc2.dvpl") : Path.Combine(directory, name + ".sc2");
            var scene = new MapScene(_reader.Read(_decoder.DecodeFile(rootFile)));
            var resources = new MapResourceResolver(directory, SourceRoot, _decoder, EnsureFreeSpace);
            var heightmap = new DavaHeightmapReader().Read(_decoder.DecodeFile(resources.Resolve(scene.HeightmapReference)));
            var names = GetNames(name);
            var calibration = _calibration.CreateFromScene(name, names.Aliases.FirstOrDefault(), heightmap, scene);
            await _calibration.SaveAsync(staging, calibration, ct);
            // Preserve old corrections as evidence, never apply compensations to newly decoded geometry.
            await ArchivePreviousCalibrationAsync(name, previous, staging, ct);
            var b = scene.Bounds;
            await _terrain.ExportAsync(name, heightmap, new(b[0], b[1], b[2], b[3], b[4], b[5]), staging, 128, ct, schemaVersion: 2);
            var warnings = new List<string>();
            var material = scene.Material(MapScene.Id(scene.Landscape.GetValueOrDefault("matname")));
            var textures = material.GetValueOrDefault("textures") as Dictionary<string, object?> ?? throw new InvalidDataException("Landscape material не содержит textures.");
            var color = textures.GetValueOrDefault("colorTexture") as string;
            if (color is null) throw new InvalidDataException("Landscape.colorTexture отсутствует: нельзя подменить случайным DDS.");
            var colorFile = resources.ExportTexture(color, staging);
            File.Copy(Path.Combine(staging, "textures", colorFile), Path.Combine(staging, "terrain_color.dds"));
            await WriteJsonAsync(staging, "terrain_texture_manifest.json", new TerrainTextureManifestDto(name, color, new FileInfo(Path.Combine(staging, "terrain_color.dds")).Length, $"/api/maps/{name}/terrain/texture.dds"), ct);
            var surfaceTextures = new List<MapSurfaceTexture>();
            foreach (var (role, value) in textures)
            {
                var references = value switch
                {
                    string reference => new[] { reference },
                    Dictionary<string, object?> array when array.GetValueOrDefault("arrayPaths") is List<object?> paths => paths.OfType<string>().ToArray(),
                    _ => Array.Empty<string>()
                };
                foreach (var reference in references)
                {
                    try { surfaceTextures.Add(new(role, reference, $"/api/maps/{name}/textures/{resources.ExportTexture(reference, staging)}", "available")); }
                    catch (Exception e) when (e is IOException or NotSupportedException)
                    {
                        surfaceTextures.Add(new(role, reference, null, "unavailable", e.Message));
                        warnings.Add($"Landscape.{role}: {reference}: {e.Message}");
                    }
                }
            }
            await WriteJsonAsync(staging, "surface_manifest.json", new MapSurfaceManifest(name, "legacy-color", surfaceTextures,
                material.GetValueOrDefault("properties"), material.GetValueOrDefault("flags")), ct);
            var scg = File.Exists(Path.Combine(directory, name + ".scg.dvpl")) ? Path.Combine(directory, name + ".scg.dvpl") : Path.Combine(directory, name + ".scg");
            var mesh = await _mesh.ExportSceneAsync(name, scene, resources, scg, staging, ct);
            warnings.AddRange(mesh.Warnings ?? []);
            await WriteJsonAsync(staging, "import_report.json", new { name, sourceHash, pipelineVersion = PipelineVersion, sourceScene = Path.GetFileName(rootFile),
                scene.Bounds, scene.HeightmapReference, heightmap.Size, mesh.VertexCount, mesh.IndexCount, entities = mesh.Instances?.Count, warnings }, ct);
            ct.ThrowIfCancellationRequested();
            Directory.Move(staging, Path.Combine(revisions, revision)); staging = null;
            await _catalog.PublishAsync(new(name, names.Title, names.Aliases, revision, sourceHash, PipelineVersion, DateTimeOffset.UtcNow, warnings), ct);
            try { PruneRevisions(name, revision); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            { warnings.Add($"Не удалось удалить старые ревизии: {e.Message}"); }
            return new(name, "imported", null, clock.ElapsedMilliseconds, warnings);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception e)
        { return new(name, "failed", e.Message, clock.ElapsedMilliseconds); }
        finally
        {
            // Only this invocation's generated staging directory can be removed.
            if (staging is not null && Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
        }
    }

    private async Task<string> FingerprintAsync(string directory, CancellationToken ct)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.UTF8.GetBytes($"map-pipeline:{PipelineVersion}\n"));
        foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(Path.GetRelativePath(directory, file).Replace('\\', '/') + "\0"));
            await using var stream = File.OpenRead(file);
            hash.AppendData(await SHA256.HashDataAsync(stream, ct));
        }
        Task<byte[]> shared;
        lock (_fingerprintGate) shared = _sharedFingerprint ??= SharedFingerprintAsync(ct);
        hash.AppendData(await shared);
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private async Task<byte[]> SharedFingerprintAsync(CancellationToken ct)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        // Shared assets are hashed once per batch, not 36 times.
        foreach (var shared in new[] { "00_shared_content", "00_global_content" })
        {
            var path = Path.Combine(SourceRoot, shared);
            if (!Directory.Exists(path)) continue;
            foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal))
            {
                hash.AppendData(Encoding.UTF8.GetBytes(Path.GetRelativePath(SourceRoot, file).Replace('\\', '/') + "\0"));
                await using var stream = File.OpenRead(file); hash.AppendData(await SHA256.HashDataAsync(stream, ct));
            }
        }
        var localization = LocalizationPath();
        if (localization is not null && File.Exists(localization))
        { await using var stream = File.OpenRead(localization); hash.AppendData(await SHA256.HashDataAsync(stream, ct)); }
        return hash.GetHashAndReset();
    }

    private (string Title, string[] Aliases) GetNames(string name)
    {
        if (_mapNames is null)
        {
            var path = LocalizationPath();
            var records = new List<(string, string, string)>();
            if (path is not null && File.Exists(path))
                foreach (var line in Encoding.UTF8.GetString(_decoder.DecodeFile(path)).Split('\n'))
                {
                    var match = Regex.Match(line.Trim(), "^\"#maps:([^:]+):([^\"]+)\":\\s*(\".*\")$");
                    if (match.Success) records.Add((match.Groups[1].Value, match.Groups[2].Value, JsonSerializer.Deserialize<string>(match.Groups[3].Value)!));
                }
            _mapNames = records;
        }
        var rows = _mapNames.Where(x => x.Path == $"{name}/{name}.sc2").ToArray();
        var main = rows.OrderBy(x => x.Alias.Length).FirstOrDefault();
        return (main.Title ?? name, rows.Select(x => x.Alias).Prepend(name).Distinct(StringComparer.Ordinal).OrderBy(x => x == main.Alias ? 0 : 1).ToArray());
    }

    private string? LocalizationPath() => _options.LocalizationPath is null
        ? (Directory.Exists(Path.Combine(_env.ContentRootPath, "ClientGameData")) ? Directory.EnumerateFiles(Path.Combine(_env.ContentRootPath, "ClientGameData"), "ru.yaml.dvpl", SearchOption.AllDirectories).Order(StringComparer.Ordinal).LastOrDefault() : null)
        : Path.GetFullPath(_options.LocalizationPath, _env.ContentRootPath);

    private async Task ArchivePreviousCalibrationAsync(string name, MapCatalogEntry? previous, string staging, CancellationToken ct)
    {
        var paths = new List<string>();
        if (previous is not null) paths.Add(Path.Combine(_catalog.GetProcessedDirectory(name), "map_calibration.json"));
        var root = Path.Combine(DataRoot, "Processed");
        if (Directory.Exists(root)) paths.AddRange(Directory.EnumerateDirectories(root, name + "-*").Select(d => Path.Combine(d, "map_calibration.json")));
        var overrides = new List<JsonElement>();
        foreach (var path in paths.Where(File.Exists))
        {
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(path, ct)); overrides.Add(doc.RootElement.Clone());
        }
        if (overrides.Count > 0) await WriteJsonAsync(staging, "previous_calibrations.json", overrides, ct);
    }

    public void PruneRevisions(string name, string activeRevision)
    {
        MapCatalogService.ValidateName(name); MapCatalogService.ValidateName(activeRevision);
        var root = Path.GetFullPath(Path.Combine(DataRoot, "Processed", name, "revisions"));
        if (!Directory.Exists(root)) return;
        if (!Path.GetFullPath(_catalog.GetProcessedDirectory(name)).Equals(Path.Combine(root, activeRevision), StringComparison.OrdinalIgnoreCase))
            throw new IOException("Очистка разрешена только после публикации активной ревизии в каталоге.");
        var keep = Directory.EnumerateDirectories(root)
            .Where(d => Regex.IsMatch(Path.GetFileName(d), @"^[a-f0-9]{20}-[a-f0-9]{8}$") && File.Exists(Path.Combine(d, "manifest.json")))
            .OrderByDescending(Directory.GetLastWriteTimeUtc).ToArray();
        var retained = keep.Where(d => Path.GetFileName(d) != activeRevision)
            .Take(Math.Clamp(_options.RetainedRevisions, 1, 10) - 1).Append(Path.Combine(root, activeRevision)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var directory in keep.Where(d => !retained.Contains(d)))
        {
            var target = Path.GetFullPath(directory);
            if (!target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                (File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0) throw new IOException("Небезопасный путь ревизии; очистка отменена.");
            Directory.Delete(target, recursive: true);
        }
    }

    private static Task WriteJsonAsync(string directory, string name, object value, CancellationToken ct) =>
        File.WriteAllTextAsync(Path.Combine(directory, name), JsonSerializer.Serialize(value, MapCatalogService.JsonOptions), ct);
}
