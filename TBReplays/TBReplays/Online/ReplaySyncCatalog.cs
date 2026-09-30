using System.Text.Json;

namespace TBReplays.Online;

public interface IReplaySyncCatalog
{
    Task<ReplaySyncInfo?> ReadAsync(string replayId, CancellationToken ct);
}

public sealed class ReplaySyncCatalog(IWebHostEnvironment environment) : IReplaySyncCatalog
{
    public async Task<ReplaySyncInfo?> ReadAsync(string replayId, CancellationToken ct)
    {
        if (replayId.Length is < 1 or > 255 || replayId.Any(c => !char.IsLetterOrDigit(c) && c is not ('-' or '_'))) return null;
        var path = Path.Combine(environment.ContentRootPath, "Data", "ParsedReplays", replayId, "parse_result.json");
        if (!File.Exists(path)) return null;
        await using var stream = File.OpenRead(path);
        using var json = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var root = json.RootElement;
        if (!root.TryGetProperty("schemaVersion", out var schema) || schema.GetInt32() < 2
            || !root.TryGetProperty("playback", out var playback)) return null;
        var min = playback.GetProperty("startTime").GetDouble();
        var max = playback.GetProperty("endTime").GetDouble();
        var map = root.TryGetProperty("mapName", out var mapName) ? mapName.GetString() : null;
        var bound = root.TryGetProperty("mapBinding", out var binding) && binding.ValueKind == JsonValueKind.Object
            && binding.TryGetProperty("matchedBackendMapId", out var mapId) ? mapId.GetString() : null;
        return double.IsFinite(min) && double.IsFinite(max) && min >= 0 && max >= min && max <= 86400
            ? new(min, max, map, bound) : null;
    }
}
