using System.Text.Json;

namespace TBReplays.Online;

// Single application instance. The OS lock prevents two writers using the same directory.
public sealed class OnlineFiles : IDisposable
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly FileStream _instanceLock;
    public string DirectoryPath { get; }
    public SemaphoreSlim AccountGate { get; } = new(1, 1);

    public OnlineFiles(IWebHostEnvironment environment, IConfiguration configuration)
    {
        DirectoryPath = Path.GetFullPath(configuration["Online:DataPath"]
            ?? Path.Combine(environment.ContentRootPath, "Data", "Online"));
        Directory.CreateDirectory(DirectoryPath);
        _instanceLock = new FileStream(Path.Combine(DirectoryPath, "instance.lock"),
            FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }

    public T Read<T>(string name, Func<T> empty)
    {
        var path = Path.Combine(DirectoryPath, name);
        // A damaged file must stop startup, never silently recreate admin/admin or an empty board.
        return File.Exists(path)
            ? JsonSerializer.Deserialize<T>(File.ReadAllBytes(path), Json)
                ?? throw new InvalidDataException($"Invalid online data: {name}")
            : empty();
    }

    public async Task WriteAsync<T>(string name, T value, CancellationToken cancellationToken)
    {
        var path = Path.Combine(DirectoryPath, name);
        var temporary = path + ".tmp";
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write,
                FileShare.None, 8192, FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, value, Json, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public void Dispose()
    {
        _instanceLock.Dispose();
        AccountGate.Dispose();
    }
}
