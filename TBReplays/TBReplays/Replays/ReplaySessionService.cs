using System.Text.Json;

namespace TBReplays.Replays;

public sealed class ReplaySessionService
{
    private static readonly TimeZoneInfo MoscowTimeZone = FindMoscowTimeZone();

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly ReplayImportService _replayImportService;

    public ReplaySessionService(ReplayImportService replayImportService)
    {
        _replayImportService = replayImportService;
    }

    public async Task<IReadOnlyList<ReplaySessionItemDto>> GetCurrentSessionAsync(
        string? mapName,
        CancellationToken cancellationToken)
    {
        var parsedReplaysDirectory = _replayImportService.GetParsedReplaysDirectory();
        if (!Directory.Exists(parsedReplaysDirectory))
        {
            return [];
        }

        var session = GetCurrentMoscowSession();
        var result = new List<ReplaySessionItemDto>();

        foreach (var replayDirectory in Directory.EnumerateDirectories(parsedReplaysDirectory))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var metadata = await TryReadMetadataAsync(
                replayDirectory,
                cancellationToken);

            if (metadata is null)
            {
                continue;
            }

            if (metadata.ImportedAtUtc < session.StartUtc || metadata.ImportedAtUtc >= session.EndUtc)
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(mapName)
                && !IsReplayForMap(metadata, mapName))
            {
                continue;
            }

            result.Add(ReplaySessionItemDto.FromMetadata(metadata));
        }

        return result
            .OrderByDescending(x => x.ImportedAtUtc)
            .ThenBy(x => x.Title, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static async Task<ReplayStoredMetadata?> TryReadMetadataAsync(
        string replayDirectory,
        CancellationToken cancellationToken)
    {
        var metadataPath = Path.Combine(replayDirectory, "metadata.json");
        if (!File.Exists(metadataPath))
        {
            return await TryCreateMetadataFromLegacyParseResultAsync(
                replayDirectory,
                cancellationToken);
        }

        try
        {
            await using var stream = File.OpenRead(metadataPath);

            return await JsonSerializer.DeserializeAsync<ReplayStoredMetadata>(
                stream,
                JsonOptions,
                cancellationToken);
        }
        catch
        {
            return null;
        }
    }

    private static async Task<ReplayStoredMetadata?> TryCreateMetadataFromLegacyParseResultAsync(
        string replayDirectory,
        CancellationToken cancellationToken)
    {
        var parseResultPath = Path.Combine(replayDirectory, "parse_result.json");
        if (!File.Exists(parseResultPath))
        {
            return null;
        }

        try
        {
            await using var stream = File.OpenRead(parseResultPath);
            var parseResult = await JsonSerializer.DeserializeAsync<ReplayParseResult>(
                stream,
                JsonOptions,
                cancellationToken);

            if (parseResult is null)
            {
                return null;
            }

            var replayId = Path.GetFileName(replayDirectory);

            // TODO: Временное MVP-решение.
            // Сейчас старые parse_result.json без metadata.json попадают в список replay только если внутри уже есть mapName.
            // Потом сделать migration/index rebuild для старых replay после появления стабильного replay storage.
            // Убрать legacy fallback, когда все replay будут импортироваться через ReplayImportService.
            return new ReplayStoredMetadata
            {
                ReplayId = replayId,
                Title = replayId,
                SourceFileName = null,
                ClientVersion = parseResult.ClientVersion,
                MapName = parseResult.MapName,
                MapId = parseResult.MapId,
                MapBinding = parseResult.MapBinding,
                BattleDuration = parseResult.BattleDuration,
                ImportedAtUtc = new DateTimeOffset(File.GetLastWriteTimeUtc(parseResultPath), TimeSpan.Zero),
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
                ParseResultUrl = $"/api/replays/{replayId}/parse-result"
            };
        }
        catch
        {
            return null;
        }
    }

    private static bool IsReplayForMap(
        ReplayStoredMetadata metadata,
        string mapName)
    {
        return ReplayMapNameMatcher.IsMatch(metadata.MapName, mapName)
               || ReplayMapNameMatcher.IsMatch(metadata.MapBinding.ReplayMapName, mapName)
               || ReplayMapNameMatcher.IsMatch(metadata.MapBinding.MatchedBackendMapId, mapName)
               || ReplayMapNameMatcher.IsMatch(metadata.MapBinding.MatchedMapKey, mapName)
               || ReplayMapNameMatcher.IsMatch(metadata.MapBinding.MatchedMapReplayName, mapName);
    }

    private static ReplaySessionWindow GetCurrentMoscowSession()
    {
        var nowUtc = DateTimeOffset.UtcNow;
        var nowMoscow = TimeZoneInfo.ConvertTime(nowUtc, MoscowTimeZone);
        var sessionStartLocal = new DateTimeOffset(
            nowMoscow.Year,
            nowMoscow.Month,
            nowMoscow.Day,
            6,
            0,
            0,
            nowMoscow.Offset);

        if (nowMoscow < sessionStartLocal)
        {
            sessionStartLocal = sessionStartLocal.AddDays(-1);
        }

        var sessionEndLocal = sessionStartLocal.AddDays(1);

        return new ReplaySessionWindow(
            sessionStartLocal.ToUniversalTime(),
            sessionEndLocal.ToUniversalTime());
    }

    private static TimeZoneInfo FindMoscowTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Russian Standard Time");
        }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/Moscow");
        }
    }

    private sealed record ReplaySessionWindow(
        DateTimeOffset StartUtc,
        DateTimeOffset EndUtc);
}
