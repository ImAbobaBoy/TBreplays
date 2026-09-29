using System.Text.Json;
using TBReplays.ClientGameData;

namespace TBReplays.Replays;

public sealed class ReplayImportService
{
    private const string ParseResultFileName = "parse_result.json";
    private const string MetadataFileName = "metadata.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false
    };

    private readonly IWebHostEnvironment _environment;
    private readonly ClientGameDataService _clientGameDataService;
    private readonly ReplayMapBindingService _replayMapBindingService;
    private readonly ReplayParseService _replayParseService;

    public ReplayImportService(
        IWebHostEnvironment environment,
        ClientGameDataService clientGameDataService,
        ReplayMapBindingService replayMapBindingService,
        ReplayParseService replayParseService)
    {
        _environment = environment;
        _clientGameDataService = clientGameDataService;
        _replayMapBindingService = replayMapBindingService;
        _replayParseService = replayParseService;
    }

    public async Task<ReplayImportItemResultDto> ImportAsync(
        Stream replayStream,
        string sourceFileName,
        CancellationToken cancellationToken)
    {
        var safeFileName = Path.GetFileName(sourceFileName);
        if (!safeFileName.EndsWith(".tbreplay", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"Ожидался .tbreplay файл: {safeFileName}");
        }

        var replayId = CreateReplayId(Path.GetFileNameWithoutExtension(safeFileName));
        var importedAtUtc = DateTimeOffset.UtcNow;
        var catalog = await _clientGameDataService.GetCatalogAsync(cancellationToken);
        var parseResult = _replayParseService.Parse(replayStream, catalog);
        var mapBinding = await _replayMapBindingService.BindAsync(
            parseResult.MapName,
            parseResult.MapId,
            cancellationToken);

        parseResult.MapBinding = mapBinding;
        parseResult.Warnings = AppendMapBindingWarnings(parseResult.Warnings, mapBinding);
        parseResult.TimelineSummary = ReplayParseService.BuildTimelineSummary(parseResult);

        var processedDirectory = GetProcessedReplayDirectory(replayId);
        Directory.CreateDirectory(processedDirectory);

        var parseResultUrl = $"/api/replays/{replayId}/parse-result";
        var title = CreateReplayTitle(safeFileName, replayId);
        var metadata = new ReplayStoredMetadata
        {
            SchemaVersion = parseResult.SchemaVersion,
            Outcome = parseResult.Outcome,
            Teams = parseResult.Teams,
            ReplayId = replayId,
            Title = title,
            SourceFileName = safeFileName,
            ClientVersion = parseResult.ClientVersion,
            MapName = parseResult.MapName,
            MapId = parseResult.MapId,
            MapBinding = mapBinding,
            BattleDuration = parseResult.BattleDuration,
            ImportedAtUtc = importedAtUtc,
            VehicleCount = parseResult.Vehicles.Count,
            MovementFrameCount = parseResult.MovementFrames.Count,
            TurretFrameCount = parseResult.TurretFrames.Count,
            ShotEventCount = parseResult.ShotEvents.Count,
            ProjectilePointCount = parseResult.ProjectilePoints.Count,
            HealthFrameCount = parseResult.HealthFrames.Count,
            VisibilityFrameCount = parseResult.VisibilityFrames.Count,
            VisibilityIntervalCount = parseResult.VisibilityIntervals.Count,
            DamageEventCount = parseResult.DamageEvents.Count,
            DeathEventCount = parseResult.DeathEvents.Count,
            ExtraStateFrameCount = parseResult.ExtraStateFrames.Count,
            ConsumableActivationCount = parseResult.ConsumableActivationEvents.Count,
            ModuleStateEventCount = parseResult.ModuleStateEvents.Count,
            ModuleHitSummaryEventCount = parseResult.ModuleHitSummaryEvents.Count,
            ModuleCompactMarkerCount = parseResult.ModuleCompactMarkers.Count,
            RepairedModuleCount = parseResult.ConsumableActivationEvents.Sum(x => x.RepairedModules.Count),
            WarningCount = parseResult.Warnings.Count,
            ParseResultUrl = parseResultUrl
        };

        await WriteJsonAtomicAsync(
            Path.Combine(processedDirectory, ParseResultFileName),
            parseResult,
            cancellationToken);

        await WriteJsonAtomicAsync(
            Path.Combine(processedDirectory, MetadataFileName),
            metadata,
            cancellationToken);

        return ReplayImportItemResultDto.FromMetadata(safeFileName, metadata);
    }

    public async Task<ReplayImportItemResultDto> ImportLocalAsync(
        string? replayFileName,
        CancellationToken cancellationToken)
    {
        var replayPath = GetLocalReplayPath(replayFileName);
        await using var replayStream = File.OpenRead(replayPath);

        return await ImportAsync(
            replayStream,
            Path.GetFileName(replayPath),
            cancellationToken);
    }

    public async Task<ReplayParseResult> GetParseResultAsync(
        string replayId,
        CancellationToken cancellationToken)
    {
        var path = Path.Combine(
            GetProcessedReplayDirectory(replayId),
            ParseResultFileName);

        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                "parse_result.json не найден. Сначала импортируй .tbreplay.",
                path);
        }

        await using var stream = File.OpenRead(path);

        var result = await JsonSerializer.DeserializeAsync<ReplayParseResult>(
            stream,
            JsonOptions,
            cancellationToken);

        return result ?? throw new InvalidDataException("parse_result.json повреждён.");
    }

    private static IReadOnlyList<ReplayParseWarning> AppendMapBindingWarnings(
        IReadOnlyList<ReplayParseWarning> source,
        ReplayMapBindingDto mapBinding)
    {
        var result = source.ToList();

        switch (mapBinding.MatchStatus)
        {
            case ReplayMapMatchStatuses.Unknown:
                result.Add(new ReplayParseWarning
                {
                    Code = ReplayParseWarningCodes.MapBindingUnknown,
                    Message = "Не удалось определить карту replay для привязки к импортированной карте."
                });
                break;

            case ReplayMapMatchStatuses.NotFound:
                result.Add(new ReplayParseWarning
                {
                    Code = ReplayParseWarningCodes.MapBindingNotFound,
                    Message = "Для карты replay не найдена импортированная backend-карта.",
                    Value = mapBinding.ReplayMapName
                });
                break;

            case ReplayMapMatchStatuses.Ambiguous:
                result.Add(new ReplayParseWarning
                {
                    Code = ReplayParseWarningCodes.MapBindingAmbiguous,
                    Message = "Для карты replay найдено несколько возможных backend-карт.",
                    Value = mapBinding.ReplayMapName
                });
                break;
        }

        return result;
    }

    public string GetProcessedReplayDirectory(string replayId)
    {
        return Path.Combine(_environment.ContentRootPath, "Data", "ParsedReplays", replayId);
    }

    public string GetParsedReplaysDirectory()
    {
        return Path.Combine(_environment.ContentRootPath, "Data", "ParsedReplays");
    }

    private string GetLocalReplayPath(string? replayFileName)
    {
        var replayFilesDirectory = FindReplayFilesDirectory();

        if (!string.IsNullOrWhiteSpace(replayFileName))
        {
            var safeFileName = Path.GetFileName(replayFileName);
            var replayPath = Path.Combine(replayFilesDirectory, safeFileName);

            if (!File.Exists(replayPath))
            {
                throw new FileNotFoundException(
                    $"Replay-файл не найден в ReplayFiles: {safeFileName}",
                    replayPath);
            }

            return replayPath;
        }

        var replays = Directory
            .EnumerateFiles(replayFilesDirectory, "*.tbreplay", SearchOption.TopDirectoryOnly)
            .ToArray();

        if (replays.Length == 0)
        {
            throw new FileNotFoundException(
                $"В ReplayFiles нет .tbreplay файлов: {replayFilesDirectory}");
        }

        if (replays.Length > 1)
        {
            throw new InvalidOperationException(
                "В ReplayFiles найдено несколько .tbreplay. Передай имя через replayFileName.");
        }

        return replays[0];
    }

    private string FindReplayFilesDirectory()
    {
        var checkedDirectories = new List<string>();
        var currentDirectory = new DirectoryInfo(_environment.ContentRootPath);

        while (currentDirectory is not null)
        {
            var candidate = Path.Combine(currentDirectory.FullName, "ReplayFiles");
            checkedDirectories.Add(candidate);

            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            currentDirectory = currentDirectory.Parent;
        }

        throw new DirectoryNotFoundException(
            "Папка ReplayFiles не найдена. Проверенные пути: "
            + string.Join("; ", checkedDirectories));
    }

    private static async Task WriteJsonAtomicAsync(
        string path,
        object value,
        CancellationToken cancellationToken)
    {
        // TODO: Временное MVP-решение.
        // Сейчас replay parse-result и metadata пишутся в JSON-файлы на диске через temp-файл и replace.
        // Потом заменить на нормальное хранилище replay/import-job с индексом по mapName/importedAtUtc.
        // Убрать файловый JSON persistence, когда появится постоянное хранилище replay-сессий.
        var directory = Path.GetDirectoryName(path)
            ?? throw new InvalidOperationException($"Не удалось определить директорию для файла: {path}");

        Directory.CreateDirectory(directory);

        var tempPath = Path.Combine(
            directory,
            $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");

        var json = JsonSerializer.Serialize(value, JsonOptions);
        await File.WriteAllTextAsync(tempPath, json, cancellationToken);
        File.Move(tempPath, path, true);
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

    private static string CreateReplayTitle(
        string sourceFileName,
        string replayId)
    {
        var title = Path.GetFileNameWithoutExtension(sourceFileName);

        return string.IsNullOrWhiteSpace(title)
            ? replayId
            : title;
    }
}
