namespace TBReplays.Maps;

public sealed class MapImportOptions
{
    public string SourceDirectory { get; set; } = "Maps_game";
    public string? LocalizationPath { get; set; }
    public string DataDirectory { get; set; } = "Data";
    public int MaxParallelMaps { get; set; } = 1;
    public int RetainedRevisions { get; set; } = 1;
    public double MinimumFreeSpaceGiB { get; set; } = 2;
}

public sealed record MapImportItem(string Name, string Status, string? Error, long DurationMs, IReadOnlyList<string>? Warnings = null);
public sealed record MapImportJob(string JobId, string Status, DateTimeOffset StartedAtUtc, DateTimeOffset? FinishedAtUtc,
    int Total, IReadOnlyList<MapImportItem> Maps, string? Error = null);

public sealed record MapSurfaceTexture(string Role, string SourceReference, string? Url, string Status, string? Error = null);
public sealed record MapSurfaceManifest(string MapName, string Profile, IReadOnlyList<MapSurfaceTexture> Textures,
    object? Properties, object? Flags);
