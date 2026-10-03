using TBReplays.Dvpl;

namespace TBReplays.Maps;

public sealed class MapResourceResolver
{
    private readonly string _sceneDirectory;
    private readonly string _resourceRoot;
    private readonly DvplDecoder _decoder;
    private readonly Action? _beforeWrite;
    private readonly Dictionary<string, string> _textureCache = new(StringComparer.Ordinal);
    public MapResourceResolver(string sceneDirectory, string resourceRoot, DvplDecoder decoder, Action? beforeWrite = null)
    {
        _sceneDirectory = Path.GetFullPath(sceneDirectory);
        _resourceRoot = Path.GetFullPath(resourceRoot);
        _decoder = decoder;
        _beforeWrite = beforeWrite;
    }

    public string Resolve(string reference, bool texture = false)
    {
        if (string.IsNullOrWhiteSpace(reference)) throw new InvalidDataException("Пустая ссылка на ресурс.");
        var relative = reference.Replace('\\', '/');
        var directory = _sceneDirectory;
        if (relative.StartsWith("~res:/", StringComparison.Ordinal))
        {
            relative = relative[6..];
            if (relative.StartsWith("3d/Maps/", StringComparison.OrdinalIgnoreCase)) relative = relative[8..];
            directory = _resourceRoot;
        }
        if (Path.IsPathRooted(relative)) throw new InvalidDataException($"Абсолютная ссылка запрещена: {reference}");
        var file = Path.GetFullPath(Path.Combine(directory, relative));
        var root = _resourceRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException($"Ресурс вне каталога Maps_game: {reference}");
        if (texture)
        {
            var stem = Path.ChangeExtension(file, null);
            foreach (var suffix in new[] { ".dx11.dds.dvpl", ".dx11.pvr.dvpl", ".dds.dvpl", ".pvr.dvpl", ".dds", ".pvr" })
                if (File.Exists(stem + suffix)) return stem + suffix;
            if (file.EndsWith(".dds", StringComparison.OrdinalIgnoreCase) || file.EndsWith(".pvr", StringComparison.OrdinalIgnoreCase))
            {
                if (File.Exists(file + ".dvpl")) return file + ".dvpl";
                if (File.Exists(file)) return file;
            }
        }
        else
        {
            if (File.Exists(file + ".dvpl")) return file + ".dvpl";
            if (File.Exists(file)) return file;
        }
        throw new FileNotFoundException($"Не найден ресурс сцены: {reference}", file);
    }

    public string ExportTexture(string reference, string outputDirectory)
    {
        var path = Resolve(reference, texture: true);
        if (_textureCache.TryGetValue(path, out var cached)) return cached;
        _beforeWrite?.Invoke();
        var name = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Path.GetRelativePath(_resourceRoot, path))))[..24].ToLowerInvariant() + ".dds";
        Directory.CreateDirectory(Path.Combine(outputDirectory, "textures"));
        var bytes = MapTextureConverter.ToDds(_decoder.DecodeFile(path));
        File.WriteAllBytes(Path.Combine(outputDirectory, "textures", name), bytes);
        _textureCache.Add(path, name);
        return name;
    }
}
