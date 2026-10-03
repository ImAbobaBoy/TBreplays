using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace TBReplays.Maps;

public sealed record MapCatalogEntry(string Name, string DisplayName, string[] ReplayMapNames, string Revision,
    string SourceHash, int PipelineVersion, DateTimeOffset ImportedAtUtc, IReadOnlyList<string> Warnings);

public sealed class MapCatalogService
{
    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, WriteIndented = true };
    public string DataRoot { get; }
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private string CatalogPath => Path.Combine(DataRoot, "map_catalog.json");
    public MapCatalogService(IWebHostEnvironment env, IOptions<MapImportOptions>? options = null) =>
        DataRoot = Path.GetFullPath(options?.Value.DataDirectory ?? "Data", env.ContentRootPath);

    public async Task<MapCatalogEntry[]> ListAsync(CancellationToken ct)
    {
        if (!File.Exists(CatalogPath)) return [];
        await using var stream = new FileStream(CatalogPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return await JsonSerializer.DeserializeAsync<MapCatalogEntry[]>(stream, JsonOptions, ct) ?? [];
    }

    public async Task PublishAsync(MapCatalogEntry entry, CancellationToken ct)
    {
        ValidateName(entry.Name); ValidateName(entry.Revision);
        await _writeLock.WaitAsync(ct);
        try
        {
            var entries = (await ListAsync(ct)).Where(x => x.Name != entry.Name).Append(entry).OrderBy(x => x.Name, StringComparer.Ordinal).ToArray();
            Directory.CreateDirectory(Path.GetDirectoryName(CatalogPath)!);
            var temporary = CatalogPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(entries, JsonOptions), ct);
                File.Move(temporary, CatalogPath, overwrite: true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        finally { _writeLock.Release(); }
    }

    public string GetProcessedDirectory(string name) => ResolveInDataDirectory(DataRoot, name);

    public static string ResolveProcessedDirectory(string root, string name)
        => ResolveInDataDirectory(Path.Combine(root, "Data"), name);

    private static string ResolveInDataDirectory(string root, string name)
    {
        ValidateName(name);
        var path = Path.Combine(root, "map_catalog.json");
        if (File.Exists(path))
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var entries = JsonSerializer.Deserialize<MapCatalogEntry[]>(stream, JsonOptions) ?? [];
            var entry = entries.FirstOrDefault(x => x.Name == name);
            // Keep old boards/replay links usable without publishing UUIDs in the new catalog.
            if (entry is null && Regex.IsMatch(name, @"-[a-f0-9]{8}$"))
                entry = entries.FirstOrDefault(x => x.Name == name[..^9]);
            if (entry is not null)
            {
                ValidateName(entry.Name); ValidateName(entry.Revision);
                return Path.Combine(root, "Processed", entry.Name, "revisions", entry.Revision);
            }
        }
        return Path.Combine(root, "Processed", name);
    }

    public static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || !Regex.IsMatch(name, @"^[a-z0-9][a-z0-9_-]{0,127}$", RegexOptions.CultureInvariant))
            throw new ArgumentException("Некорректное имя карты или ресурса.", nameof(name));
    }
}
