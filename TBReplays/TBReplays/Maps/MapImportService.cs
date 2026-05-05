using System.IO.Compression;
using System.Text.Json;
using TBReplays.Dvpl;
using TBReplays.Sc2;
using TBReplays.Scg;
using TBReplays.Terrain;

namespace TBReplays.Maps;

public sealed class MapImportService
{
    private const int DefaultChunkCellSize = 128;
    
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private static readonly TerrainBoundsDto DefaultBounds = new(
        MinX: -300f,
        MinY: -300f,
        MinZ: 0f,
        MaxX: 300f,
        MaxY: 300f,
        MaxZ: 82f);

    private readonly IWebHostEnvironment _environment;
    private readonly DvplDecoder _dvplDecoder;
    private readonly DavaHeightmapReader _heightmapReader;
    private readonly TerrainChunkExporter _terrainChunkExporter;
    private readonly Sc2MapObjectExtractor _sc2MapObjectExtractor;
    private readonly ScgMapMeshExportService _scgMapMeshExportService;

    public MapImportService(
        IWebHostEnvironment environment,
        DvplDecoder dvplDecoder,
        DavaHeightmapReader heightmapReader,
        TerrainChunkExporter terrainChunkExporter,
        Sc2MapObjectExtractor sc2MapObjectExtractor,
        ScgMapMeshExportService scgMapMeshExportService)
    {
        _environment = environment;
        _dvplDecoder = dvplDecoder;
        _heightmapReader = heightmapReader;
        _terrainChunkExporter = terrainChunkExporter;
        _sc2MapObjectExtractor = sc2MapObjectExtractor;
        _scgMapMeshExportService = scgMapMeshExportService;
    }

    public async Task<MapImportResultDto> ImportAsync(
        IFormFile archive,
        CancellationToken cancellationToken)
    {
        if (archive.Length == 0)
        {
            throw new InvalidDataException("Архив пустой.");
        }

        var mapId = CreateMapId(archive.FileName);

        var importedDirectory = GetImportedDirectory(mapId);
        var processedDirectory = GetProcessedDirectory(mapId);

        Directory.CreateDirectory(importedDirectory);
        Directory.CreateDirectory(processedDirectory);

        await using var archiveStream = archive.OpenReadStream();

        await ExtractZipFromStreamAsync(
            archiveStream,
            importedDirectory,
            cancellationToken);

        var heightmapPath = FindHeightmapPath(importedDirectory);

        var heightmapBytes = _dvplDecoder.DecodeFile(heightmapPath);
        var heightmap = _heightmapReader.Read(heightmapBytes);

        await _terrainChunkExporter.ExportAsync(
            mapId,
            heightmap,
            DefaultBounds,
            processedDirectory,
            DefaultChunkCellSize,
            cancellationToken);

        await ExportTerrainTextureAsync(
            mapId,
            importedDirectory,
            processedDirectory,
            cancellationToken);

        await ExportMapObjectsAsync(
            mapId,
            importedDirectory,
            processedDirectory,
            cancellationToken);
        
        await _scgMapMeshExportService.ExportAsync(
            mapId,
            importedDirectory,
            processedDirectory,
            cancellationToken);

        return new MapImportResultDto(
            MapId: mapId,
            ManifestUrl: $"/api/maps/{mapId}/manifest");
    }
    
    public async Task<MapImportResultDto> ImportFromLocalArchiveAsync(
        string? archiveFileName,
        CancellationToken cancellationToken)
    {
        var archivePath = GetLocalArchivePath(archiveFileName);

        var mapId = CreateMapId(Path.GetFileName(archivePath));

        var importedDirectory = GetImportedDirectory(mapId);
        var processedDirectory = GetProcessedDirectory(mapId);

        Directory.CreateDirectory(importedDirectory);
        Directory.CreateDirectory(processedDirectory);

        await using var archiveStream = File.OpenRead(archivePath);

        await ExtractZipFromStreamAsync(
            archiveStream,
            importedDirectory,
            cancellationToken);

        var heightmapPath = FindHeightmapPath(importedDirectory);

        var heightmapBytes = _dvplDecoder.DecodeFile(heightmapPath);
        var heightmap = _heightmapReader.Read(heightmapBytes);

        await _terrainChunkExporter.ExportAsync(
            mapId,
            heightmap,
            DefaultBounds,
            processedDirectory,
            DefaultChunkCellSize,
            cancellationToken);

        await ExportTerrainTextureAsync(
            mapId,
            importedDirectory,
            processedDirectory,
            cancellationToken);

        await ExportMapObjectsAsync(
            mapId,
            importedDirectory,
            processedDirectory,
            cancellationToken);
        
        await _scgMapMeshExportService.ExportAsync(
            mapId,
            importedDirectory,
            processedDirectory,
            cancellationToken);

        return new MapImportResultDto(
            MapId: mapId,
            ManifestUrl: $"/api/maps/{mapId}/manifest");
    }

    public async Task<MapManifestDto> GetManifestAsync(
        string mapId,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(GetProcessedDirectory(mapId), "manifest.json");

        if (!File.Exists(manifestPath))
        {
            throw new FileNotFoundException("Manifest карты не найден.", manifestPath);
        }

        await using var stream = File.OpenRead(manifestPath);

        var manifest = await JsonSerializer.DeserializeAsync<MapManifestDto>(
            stream,
            JsonOptions,
            cancellationToken);

        return manifest ?? throw new InvalidDataException("Manifest повреждён.");
    }

    public string GetChunkPath(string mapId, int chunkX, int chunkY)
    {
        if (chunkX < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(chunkX));
        }

        if (chunkY < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(chunkY));
        }

        var fileName = TerrainChunkExporter.GetChunkFileName(chunkX, chunkY);
        var chunkPath = Path.Combine(GetProcessedDirectory(mapId), fileName);

        if (!File.Exists(chunkPath))
        {
            throw new FileNotFoundException("Чанк рельефа не найден.", chunkPath);
        }

        return chunkPath;
    }
    
    public async Task<TerrainTextureManifestDto> GetTerrainTextureManifestAsync(
        string mapId,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(GetProcessedDirectory(mapId), "terrain_texture_manifest.json");

        if (!File.Exists(manifestPath))
        {
            throw new FileNotFoundException(
                "terrain_texture_manifest.json не найден. Переимпортируй карту после добавления terrain texture exporter.",
                manifestPath);
        }

        await using var stream = File.OpenRead(manifestPath);

        var manifest = await JsonSerializer.DeserializeAsync<TerrainTextureManifestDto>(
            stream,
            JsonOptions,
            cancellationToken);

        return manifest ?? throw new InvalidDataException("terrain_texture_manifest.json повреждён.");
    }

    public string GetTerrainTexturePath(string mapId)
    {
        var path = Path.Combine(GetProcessedDirectory(mapId), "terrain_color.dds");

        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                "terrain_color.dds не найден. Переимпортируй карту после добавления terrain texture exporter.",
                path);
        }

        return path;
    }
    
    private async Task ExportTerrainTextureAsync(
        string mapId,
        string importedDirectory,
        string processedDirectory,
        CancellationToken cancellationToken)
    {
        var texturePath = FindTerrainTexturePath(importedDirectory);

        if (texturePath is null)
        {
            var emptyManifest = new TerrainTextureManifestDto(
                MapId: mapId,
                FileName: string.Empty,
                SizeBytes: 0,
                Url: string.Empty);

            var emptyJson = JsonSerializer.Serialize(emptyManifest, JsonOptions);

            await File.WriteAllTextAsync(
                Path.Combine(processedDirectory, "terrain_texture_manifest.json"),
                emptyJson,
                cancellationToken);

            return;
        }

        var textureBytes = _dvplDecoder.DecodeFile(texturePath);
        var outputPath = Path.Combine(processedDirectory, "terrain_color.dds");

        await File.WriteAllBytesAsync(outputPath, textureBytes, cancellationToken);

        var manifest = new TerrainTextureManifestDto(
            MapId: mapId,
            FileName: Path.GetFileName(texturePath),
            SizeBytes: textureBytes.LongLength,
            Url: $"/api/maps/{mapId}/terrain/texture.dds");

        var json = JsonSerializer.Serialize(manifest, JsonOptions);

        await File.WriteAllTextAsync(
            Path.Combine(processedDirectory, "terrain_texture_manifest.json"),
            json,
            cancellationToken);
    }

    private static string? FindTerrainTexturePath(string directory)
    {
        var preferred = Directory
            .EnumerateFiles(directory, "colorTexture*.dds.dvpl", SearchOption.AllDirectories)
            .Where(x => x.Contains($"{Path.DirectorySeparatorChar}landscape{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase))
            .OrderBy(x => x.Length)
            .FirstOrDefault();

        if (preferred is not null)
        {
            return preferred;
        }

        var pbrAlbedo = Directory
            .EnumerateFiles(directory, "pbrAlbedoRoughnessMap*.dds.dvpl", SearchOption.AllDirectories)
            .Where(x => x.Contains($"{Path.DirectorySeparatorChar}landscape{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase))
            .OrderBy(x => x.Length)
            .FirstOrDefault();

        if (pbrAlbedo is not null)
        {
            return pbrAlbedo;
        }

        return Directory
            .EnumerateFiles(directory, "*.dds.dvpl", SearchOption.AllDirectories)
            .Where(x => x.Contains($"{Path.DirectorySeparatorChar}landscape{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase))
            .OrderBy(x => x.Length)
            .FirstOrDefault();
    }

    private static async Task ExtractZipFromStreamAsync(
        Stream archiveStream,
        string destinationDirectory,
        CancellationToken cancellationToken)
    {
        using var zipArchive = new ZipArchive(
            archiveStream,
            ZipArchiveMode.Read,
            leaveOpen: true);

        var destinationRoot = Path.GetFullPath(destinationDirectory);

        if (!destinationRoot.EndsWith(Path.DirectorySeparatorChar))
        {
            destinationRoot += Path.DirectorySeparatorChar;
        }

        foreach (var entry in zipArchive.Entries)
        {
            if (string.IsNullOrWhiteSpace(entry.Name))
            {
                continue;
            }

            var targetPath = Path.GetFullPath(Path.Combine(destinationDirectory, entry.FullName));

            if (!targetPath.StartsWith(destinationRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Архив содержит небезопасный путь.");
            }

            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);

            await using var entryStream = entry.Open();
            await using var outputStream = File.Create(targetPath);

            await entryStream.CopyToAsync(outputStream, cancellationToken);
        }
    }
    
    private string GetLocalArchivePath(string? archiveFileName)
    {
        var mapsFilesDirectory = Path.Combine(_environment.ContentRootPath, "MapsFiles");

        if (!Directory.Exists(mapsFilesDirectory))
        {
            throw new DirectoryNotFoundException(
                $"Папка с архивами карт не найдена: {mapsFilesDirectory}");
        }

        if (!string.IsNullOrWhiteSpace(archiveFileName))
        {
            var safeFileName = Path.GetFileName(archiveFileName);
            var archivePath = Path.Combine(mapsFilesDirectory, safeFileName);

            if (!File.Exists(archivePath))
            {
                throw new FileNotFoundException(
                    $"Архив карты не найден в папке MapsFiles: {safeFileName}",
                    archivePath);
            }

            return archivePath;
        }

        var archives = Directory
            .EnumerateFiles(mapsFilesDirectory, "*.zip", SearchOption.TopDirectoryOnly)
            .ToArray();

        if (archives.Length == 0)
        {
            throw new FileNotFoundException(
                $"В папке MapsFiles нет zip-архивов: {mapsFilesDirectory}");
        }

        if (archives.Length > 1)
        {
            throw new InvalidOperationException(
                "В папке MapsFiles найдено несколько zip-архивов. Передай имя файла через archiveFileName.");
        }

        return archives[0];
    }

    private static string FindHeightmapPath(string directory)
    {
        var candidates = Directory
            .EnumerateFiles(directory, "*.heightmap.dvpl", SearchOption.AllDirectories)
            .ToArray();

        if (candidates.Length == 0)
        {
            throw new FileNotFoundException("В архиве не найден *.heightmap.dvpl.");
        }

        var landscapeCandidate = candidates
            .FirstOrDefault(x => x.Contains($"{Path.DirectorySeparatorChar}landscape{Path.DirectorySeparatorChar}",
                StringComparison.OrdinalIgnoreCase));

        return landscapeCandidate ?? candidates[0];
    }

    private string GetImportedDirectory(string mapId)
    {
        return Path.Combine(_environment.ContentRootPath, "Data", "Imported", mapId);
    }

    private string GetProcessedDirectory(string mapId)
    {
        return Path.Combine(_environment.ContentRootPath, "Data", "Processed", mapId);
    }

    private static string CreateMapId(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);

        var safeNameChars = name
            .Select(x => char.IsLetterOrDigit(x) || x is '-' or '_' ? x : '-')
            .ToArray();

        var safeName = new string(safeNameChars)
            .Trim('-')
            .ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(safeName))
        {
            safeName = "map";
        }

        var suffix = Guid.NewGuid().ToString("N")[..8];

        return $"{safeName}-{suffix}";
    }
    
    public async Task<MapObjectSetDto> GetObjectsAsync(
        string mapId,
        CancellationToken cancellationToken)
    {
        var objectsPath = Path.Combine(GetProcessedDirectory(mapId), "objects.json");

        if (!File.Exists(objectsPath))
        {
            throw new FileNotFoundException(
                "objects.json не найден. Переимпортируй карту после добавления SC2 extractor.",
                objectsPath);
        }

        await using var stream = File.OpenRead(objectsPath);

        var objects = await JsonSerializer.DeserializeAsync<MapObjectSetDto>(
            stream,
            JsonOptions,
            cancellationToken);

        return objects ?? throw new InvalidDataException("objects.json повреждён.");
    }
    
    private async Task ExportMapObjectsAsync(
        string mapId,
        string importedDirectory,
        string processedDirectory,
        CancellationToken cancellationToken)
    {
        var sc2Path = FindSc2Path(importedDirectory);

        if (sc2Path is null)
        {
            var emptyObjects = new MapObjectSetDto(
                MapId: mapId,
                Count: 0,
                Objects: []);

            var emptyJson = JsonSerializer.Serialize(emptyObjects, JsonOptions);
            var emptyPath = Path.Combine(processedDirectory, "objects.json");

            await File.WriteAllTextAsync(emptyPath, emptyJson, cancellationToken);

            return;
        }

        var sc2Bytes = _dvplDecoder.DecodeFile(sc2Path);
        var objects = _sc2MapObjectExtractor.Extract(mapId, sc2Bytes);

        var outputPath = Path.Combine(processedDirectory, "objects.json");
        var json = JsonSerializer.Serialize(objects, JsonOptions);

        await File.WriteAllTextAsync(outputPath, json, cancellationToken);
    }

    private static string? FindSc2Path(string directory)
    {
        var dvplCandidates = Directory
            .EnumerateFiles(directory, "*.sc2.dvpl", SearchOption.AllDirectories)
            .ToArray();

        if (dvplCandidates.Length > 0)
        {
            return dvplCandidates
                .OrderBy(x => x.Length)
                .First();
        }

        var rawCandidates = Directory
            .EnumerateFiles(directory, "*.sc2", SearchOption.AllDirectories)
            .ToArray();

        return rawCandidates
            .OrderBy(x => x.Length)
            .FirstOrDefault();
    }
    
    public async Task<MapObjectMeshManifestDto> GetObjectMeshManifestAsync(
        string mapId,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(GetProcessedDirectory(mapId), "objects_mesh_manifest.json");

        if (!File.Exists(manifestPath))
        {
            throw new FileNotFoundException(
                "objects_mesh_manifest.json не найден. Переимпортируй карту после добавления SCG exporter.",
                manifestPath);
        }

        await using var stream = File.OpenRead(manifestPath);

        var manifest = await JsonSerializer.DeserializeAsync<MapObjectMeshManifestDto>(
            stream,
            JsonOptions,
            cancellationToken);

        return manifest ?? throw new InvalidDataException("objects_mesh_manifest.json повреждён.");
    }

    public string GetObjectMeshPath(string mapId)
    {
        var path = Path.Combine(GetProcessedDirectory(mapId), "objects_mesh.bin");

        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                "objects_mesh.bin не найден. Переимпортируй карту после добавления SCG exporter.",
                path);
        }

        return path;
    }
}