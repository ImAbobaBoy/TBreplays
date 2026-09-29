using System.Text.Json;
using TBReplays.Maps.Calibration;

namespace TBReplays.Replays;

public sealed class ReplayMapBindingService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly IWebHostEnvironment _environment;

    public ReplayMapBindingService(IWebHostEnvironment environment)
    {
        _environment = environment;
    }

    public async Task<ReplayMapBindingDto> BindAsync(
        string? replayMapName,
        int? replayMapId,
        CancellationToken cancellationToken)
    {
        var normalizedReplayMapName = ReplayMapNameMatcher.Normalize(replayMapName);
        if (string.IsNullOrWhiteSpace(normalizedReplayMapName))
        {
            return new ReplayMapBindingDto
            {
                ReplayMapName = replayMapName,
                ReplayMapId = replayMapId,
                NormalizedReplayMapName = normalizedReplayMapName,
                MatchStatus = ReplayMapMatchStatuses.Unknown
            };
        }

        var importedMaps = await ReadImportedMapsAsync(cancellationToken);
        var matches = importedMaps
            .SelectMany(x => CreateMatches(x, replayMapName))
            .GroupBy(x => x.BackendMapId, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.First())
            .OrderBy(x => x.BackendMapId, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (matches.Length == 0)
        {
            return new ReplayMapBindingDto
            {
                ReplayMapName = replayMapName,
                ReplayMapId = replayMapId,
                NormalizedReplayMapName = normalizedReplayMapName,
                MatchStatus = ReplayMapMatchStatuses.NotFound
            };
        }

        if (matches.Length > 1)
        {
            return new ReplayMapBindingDto
            {
                ReplayMapName = replayMapName,
                ReplayMapId = replayMapId,
                NormalizedReplayMapName = normalizedReplayMapName,
                MatchStatus = ReplayMapMatchStatuses.Ambiguous,
                Candidates = matches
            };
        }

        var match = matches[0];
        return new ReplayMapBindingDto
        {
            ReplayMapName = replayMapName,
            ReplayMapId = replayMapId,
            NormalizedReplayMapName = normalizedReplayMapName,
            MatchStatus = ReplayMapMatchStatuses.Matched,
            MatchedBackendMapId = match.BackendMapId,
            MatchedMapKey = match.MapKey,
            MatchedMapReplayName = match.ReplayMapName,
            Candidates = matches
        };
    }

    private async Task<IReadOnlyList<ImportedMapInfo>> ReadImportedMapsAsync(CancellationToken cancellationToken)
    {
        var processedDirectory = Path.Combine(_environment.ContentRootPath, "Data", "Processed");
        if (!Directory.Exists(processedDirectory))
        {
            return [];
        }

        var result = new List<ImportedMapInfo>();

        foreach (var mapDirectory in Directory.EnumerateDirectories(processedDirectory))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var calibrationPath = Path.Combine(mapDirectory, "map_calibration.json");
            if (!File.Exists(calibrationPath))
            {
                continue;
            }

            var calibration = await TryReadCalibrationAsync(
                calibrationPath,
                cancellationToken);

            if (calibration is null)
            {
                continue;
            }

            var directoryMapId = Path.GetFileName(mapDirectory);
            var mapId = string.IsNullOrWhiteSpace(calibration.MapId)
                ? directoryMapId
                : calibration.MapId;

            result.Add(new ImportedMapInfo(
                BackendMapId: mapId,
                MapKey: calibration.MapKey,
                ReplayMapName: calibration.ReplayMapName));
        }

        return result;
    }

    private static async Task<MapCalibrationDto?> TryReadCalibrationAsync(
        string calibrationPath,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = File.OpenRead(calibrationPath);

            return await JsonSerializer.DeserializeAsync<MapCalibrationDto>(
                stream,
                JsonOptions,
                cancellationToken);
        }
        catch (Exception exception) when (exception is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static IEnumerable<ReplayMapBindingCandidateDto> CreateMatches(
        ImportedMapInfo map,
        string? replayMapName)
    {
        if (ReplayMapNameMatcher.IsMatch(map.ReplayMapName, replayMapName))
        {
            yield return ToCandidate(map, "calibrationReplayMapName");
        }

        if (ReplayMapNameMatcher.IsMatch(map.MapKey, replayMapName))
        {
            yield return ToCandidate(map, "mapKey");
        }

        if (ReplayMapNameMatcher.IsMatch(map.BackendMapId, replayMapName))
        {
            yield return ToCandidate(map, "backendMapId");
        }
    }

    private static ReplayMapBindingCandidateDto ToCandidate(
        ImportedMapInfo map,
        string matchSource)
    {
        return new ReplayMapBindingCandidateDto
        {
            BackendMapId = map.BackendMapId,
            MapKey = map.MapKey,
            ReplayMapName = map.ReplayMapName,
            MatchSource = matchSource
        };
    }

    private sealed record ImportedMapInfo(
        string BackendMapId,
        string MapKey,
        string? ReplayMapName);
}
