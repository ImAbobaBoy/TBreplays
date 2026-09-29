using Microsoft.Extensions.Options;

namespace TBReplays.ClientGameData;

public sealed record ClientGameDataVersionPath(string Version, string RootPath);

public sealed class ClientGameDataPathResolver
{
    private readonly IWebHostEnvironment _environment;
    private readonly IOptions<ClientGameDataOptions> _options;

    public ClientGameDataPathResolver(
        IWebHostEnvironment environment,
        IOptions<ClientGameDataOptions> options)
    {
        _environment = environment;
        _options = options;
    }

    public ClientGameDataVersionPath Resolve()
    {
        var rootPath = ResolveRootPath();
        if (!Directory.Exists(rootPath))
        {
            throw new DirectoryNotFoundException($"ClientGameData root was not found: {rootPath}");
        }

        var preferredVersion = _options.Value.PreferredVersion;
        if (!string.IsNullOrWhiteSpace(preferredVersion))
        {
            var preferredPath = Path.Combine(rootPath, preferredVersion);
            if (Directory.Exists(preferredPath))
            {
                return new ClientGameDataVersionPath(preferredVersion, preferredPath);
            }
        }

        var versionDirectory = Directory.EnumerateDirectories(rootPath)
            .OrderByDescending(Path.GetFileName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();

        if (versionDirectory is null)
        {
            throw new DirectoryNotFoundException($"ClientGameData versions were not found in: {rootPath}");
        }

        return new ClientGameDataVersionPath(
            Path.GetFileName(versionDirectory),
            versionDirectory);
    }

    private string ResolveRootPath()
    {
        var configuredRoot = _options.Value.RootPath;
        if (string.IsNullOrWhiteSpace(configuredRoot))
        {
            configuredRoot = "ClientGameData";
        }

        return Path.IsPathRooted(configuredRoot)
            ? configuredRoot
            : Path.Combine(_environment.ContentRootPath, configuredRoot);
    }
}
