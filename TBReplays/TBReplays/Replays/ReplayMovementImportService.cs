using System.IO.Compression;
using System.Text.Json;

namespace TBReplays.Replays;

public sealed class ReplayMovementImportService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private readonly IWebHostEnvironment _environment;
    private readonly ReplayMovementCsvParser _parser;

    public ReplayMovementImportService(
        IWebHostEnvironment environment,
        ReplayMovementCsvParser parser)
    {
        _environment = environment;
        _parser = parser;
    }

    public async Task<ReplayMovementImportResultDto> ImportFromLocalArchiveAsync(
        string? archiveFileName,
        CancellationToken cancellationToken)
    {
        var archivePath = GetLocalArchivePath(archiveFileName);
        var replayId = CreateReplayId(Path.GetFileNameWithoutExtension(archivePath));

        await using var archiveStream = File.OpenRead(archivePath);
        using var zipArchive = new ZipArchive(
            archiveStream,
            ZipArchiveMode.Read,
            leaveOpen: true);

        var movementsEntry = zipArchive.Entries
            .FirstOrDefault(x => string.Equals(
                Path.GetFileName(x.FullName),
                "movements_type10.csv",
                StringComparison.OrdinalIgnoreCase));

        if (movementsEntry is null)
        {
            throw new FileNotFoundException("В архиве не найден movements_type10.csv.");
        }

        var meta = await ReadMetaAsync(zipArchive, cancellationToken);

        await using var movementsStream = movementsEntry.Open();

        var movementSet = _parser.Parse(
            replayId,
            meta.MapName,
            meta.MapId,
            meta.BattleDuration,
            movementsStream);

        var processedDirectory = GetProcessedReplayDirectory(replayId);
        Directory.CreateDirectory(processedDirectory);

        var outputPath = Path.Combine(processedDirectory, "movements.json");
        var json = JsonSerializer.Serialize(movementSet, JsonOptions);

        await File.WriteAllTextAsync(outputPath, json, cancellationToken);

        return new ReplayMovementImportResultDto(
            ReplayId: replayId,
            MapName: movementSet.MapName,
            MapId: movementSet.MapId,
            TrackCount: movementSet.TrackCount,
            SampleCount: movementSet.SampleCount,
            MovementsUrl: $"/api/replays/{replayId}/movements");
    }

    public async Task<ReplayMovementSetDto> GetMovementsAsync(
        string replayId,
        CancellationToken cancellationToken)
    {
        var path = Path.Combine(GetProcessedReplayDirectory(replayId), "movements.json");

        if (!File.Exists(path))
        {
            throw new FileNotFoundException("Движения replay не найдены.", path);
        }

        await using var stream = File.OpenRead(path);

        var movementSet = await JsonSerializer.DeserializeAsync<ReplayMovementSetDto>(
            stream,
            JsonOptions,
            cancellationToken);

        return movementSet ?? throw new InvalidDataException("movements.json повреждён.");
    }

    private async Task<ReplayMeta> ReadMetaAsync(
        ZipArchive zipArchive,
        CancellationToken cancellationToken)
    {
        var metaEntry = zipArchive.Entries
            .FirstOrDefault(x => string.Equals(
                Path.GetFileName(x.FullName),
                "meta.json",
                StringComparison.OrdinalIgnoreCase));

        if (metaEntry is null)
        {
            return new ReplayMeta(null, null, null);
        }

        await using var stream = metaEntry.Open();

        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: cancellationToken);

        var root = document.RootElement;

        var mapName = TryGetString(root, "mapName");
        var mapId = TryGetInt(root, "mapId");
        var battleDuration = TryGetDouble(root, "battleDuration");

        return new ReplayMeta(mapName, mapId, battleDuration);
    }

    private string GetLocalArchivePath(string? archiveFileName)
    {
        var replayFilesDirectory = Path.Combine(_environment.ContentRootPath, "ReplayFiles");

        if (!Directory.Exists(replayFilesDirectory))
        {
            throw new DirectoryNotFoundException(
                $"Папка с replay-архивами не найдена: {replayFilesDirectory}");
        }

        if (!string.IsNullOrWhiteSpace(archiveFileName))
        {
            var safeFileName = Path.GetFileName(archiveFileName);
            var archivePath = Path.Combine(replayFilesDirectory, safeFileName);

            if (!File.Exists(archivePath))
            {
                throw new FileNotFoundException(
                    $"Replay-архив не найден в ReplayFiles: {safeFileName}",
                    archivePath);
            }

            return archivePath;
        }

        var archives = Directory
            .EnumerateFiles(replayFilesDirectory, "*.zip", SearchOption.TopDirectoryOnly)
            .ToArray();

        if (archives.Length == 0)
        {
            throw new FileNotFoundException(
                $"В папке ReplayFiles нет zip-архивов: {replayFilesDirectory}");
        }

        if (archives.Length > 1)
        {
            throw new InvalidOperationException(
                "В папке ReplayFiles найдено несколько zip-архивов. Передай имя через archiveFileName.");
        }

        return archives[0];
    }

    private string GetProcessedReplayDirectory(string replayId)
    {
        return Path.Combine(_environment.ContentRootPath, "Data", "ProcessedReplays", replayId);
    }

    private static string CreateReplayId(string name)
    {
        var safeNameChars = name
            .Select(x => char.IsLetterOrDigit(x) || x is '-' or '_' ? x : '-')
            .ToArray();

        var safeName = new string(safeNameChars)
            .Trim('-')
            .ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(safeName))
        {
            safeName = "replay";
        }

        var suffix = Guid.NewGuid().ToString("N")[..8];

        return $"{safeName}-{suffix}";
    }

    private static string? TryGetString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var value)
            ? value.GetString()
            : null;
    }

    private static int? TryGetInt(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.GetInt32(),
            JsonValueKind.String when int.TryParse(value.GetString(), out var parsed) => parsed,
            _ => null
        };
    }

    private static double? TryGetDouble(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number => value.GetDouble(),
            JsonValueKind.String when double.TryParse(value.GetString(), out var parsed) => parsed,
            _ => null
        };
    }

    private sealed record ReplayMeta(
        string? MapName,
        int? MapId,
        double? BattleDuration);
}