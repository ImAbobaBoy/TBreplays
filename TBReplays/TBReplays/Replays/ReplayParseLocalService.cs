using System.Text.Json;

namespace TBReplays.Replays;

public sealed class ReplayParseLocalService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false
    };

    private readonly IWebHostEnvironment _environment;
    private readonly ReplayParseService _replayParseService;

    public ReplayParseLocalService(
        IWebHostEnvironment environment,
        ReplayParseService replayParseService)
    {
        _environment = environment;
        _replayParseService = replayParseService;
    }

    public async Task<ReplayParseLocalResultDto> ParseLocalAsync(
        string? replayFileName,
        CancellationToken cancellationToken)
    {
        var replayPath = GetLocalReplayPath(replayFileName);
        var replayId = CreateReplayId(Path.GetFileNameWithoutExtension(replayPath));

        await using var replayStream = File.OpenRead(replayPath);

        var parseResult = _replayParseService.Parse(replayStream);

        var processedDirectory = GetProcessedReplayDirectory(replayId);
        Directory.CreateDirectory(processedDirectory);

        var resultPath = Path.Combine(processedDirectory, "parse_result.json");
        var json = JsonSerializer.Serialize(parseResult, JsonOptions);

        await File.WriteAllTextAsync(resultPath, json, cancellationToken);

        return new ReplayParseLocalResultDto
        {
            ReplayId = replayId,
            VehicleCount = parseResult.Vehicles.Count,
            MovementFrameCount = parseResult.MovementFrames.Count,
            TurretFrameCount = parseResult.TurretFrames.Count,
            ShotEventCount = parseResult.ShotEvents.Count,
            ProjectilePointCount = parseResult.ProjectilePoints.Count,
            HealthFrameCount = parseResult.HealthFrames.Count,
            ParseResultUrl = $"/api/replays/{replayId}/parse-result"
        };
    }

    public async Task<ReplayParseResult> GetParseResultAsync(
        string replayId,
        CancellationToken cancellationToken)
    {
        var path = Path.Combine(GetProcessedReplayDirectory(replayId), "parse_result.json");

        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                "parse_result.json не найден. Сначала вызови parse-local для .tbreplay.",
                path);
        }

        await using var stream = File.OpenRead(path);

        var result = await JsonSerializer.DeserializeAsync<ReplayParseResult>(
            stream,
            JsonOptions,
            cancellationToken);

        return result ?? throw new InvalidDataException("parse_result.json повреждён.");
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

    private string GetProcessedReplayDirectory(string replayId)
    {
        return Path.Combine(_environment.ContentRootPath, "Data", "ParsedReplays", replayId);
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
}