using System.Threading.Channels;

namespace TBReplays.Maps;

public sealed class MapImportWorker : BackgroundService
{
    private readonly MapDirectoryImporter _importer;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<MapImportWorker> _logger;
    private readonly Channel<bool> _requests = Channel.CreateBounded<bool>(1);
    private readonly object _gate = new();
    private MapImportJob? _job;
    private bool _busy;
    public MapImportWorker(MapDirectoryImporter importer, IWebHostEnvironment env, ILogger<MapImportWorker>? logger = null)
    { _importer = importer; _env = env; _logger = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<MapImportWorker>.Instance; }

    public MapImportJob Start(bool force)
    {
        lock (_gate)
        {
            if (_busy) throw new InvalidOperationException("Импорт карт уже выполняется.");
            // Fail synchronously for a missing/misconfigured source directory.
            var total = _importer.Discover().Length;
            if (total == 0) throw new InvalidDataException("В каталоге нет корневых игровых карт SC2.");
            _importer.EnsureFreeSpace();
            _job = new(Guid.NewGuid().ToString("N"), "queued", DateTimeOffset.UtcNow, null, total, []);
            if (!_requests.Writer.TryWrite(force)) throw new InvalidOperationException("Очередь импорта занята.");
            _busy = true;
            return _job;
        }
    }

    public MapImportJob? Get(string id)
    {
        lock (_gate) if (_job?.JobId == id) return _job;
        if (!System.Text.RegularExpressions.Regex.IsMatch(id, @"^[a-f0-9]{32}$")) return null;
        var path = Path.Combine(_importer.DataRoot, "ImportJobs", id + ".json");
        var saved = File.Exists(path) ? System.Text.Json.JsonSerializer.Deserialize<MapImportJob>(File.ReadAllText(path), MapCatalogService.JsonOptions) : null;
        return saved is { Status: "queued" or "running" }
            ? saved with { Status = "failed", Error = "Процесс бека перезапущен до завершения задания. Повторите обычный импорт без force: готовые карты будут пропущены." }
            : saved;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var force in _requests.Reader.ReadAllAsync(stoppingToken))
        {
            lock (_gate) _job = _job! with { Status = "running" };
            await TrySaveAsync(stoppingToken);
            try
            {
                var directories = _importer.Discover();
                await _importer.PrepareBatchAsync(stoppingToken);
                await Parallel.ForEachAsync(directories, new ParallelOptions { MaxDegreeOfParallelism = _importer.MaxParallelMaps, CancellationToken = stoppingToken }, async (directory, ct) =>
                {
                    var result = await _importer.ImportAsync(directory, force, ct);
                    lock (_gate) _job = _job! with { Maps = _job.Maps.Append(result).OrderBy(x => x.Name).ToArray() };
                    await TrySaveAsync(stoppingToken);
                });
                lock (_gate) _job = _job! with { Status = _job.Maps.Any(x => x.Status == "failed") ? "completed-with-errors" : "completed", FinishedAtUtc = DateTimeOffset.UtcNow };
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            { lock (_gate) _job = _job! with { Status = "cancelled", FinishedAtUtc = DateTimeOffset.UtcNow }; }
            catch (Exception e)
            { lock (_gate) _job = _job! with { Status = "failed", FinishedAtUtc = DateTimeOffset.UtcNow, Error = e.Message }; }
            await TrySaveAsync(CancellationToken.None);
            lock (_gate) _busy = false;
        }
    }

    private readonly SemaphoreSlim _saveLock = new(1, 1);
    private async Task TrySaveAsync(CancellationToken ct)
    {
        try { await SaveAsync(ct); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { _logger.LogError(e, "Не удалось сохранить отчёт импорта в {DataRoot}. Состояние остаётся доступным в памяти.", _importer.DataRoot); }
    }
    private async Task SaveAsync(CancellationToken ct)
    {
        await _saveLock.WaitAsync(ct);
        try
        {
            MapImportJob job; lock (_gate) job = _job!;
            var directory = Path.Combine(_importer.DataRoot, "ImportJobs"); Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, job.JobId + ".json"); var temp = path + ".tmp";
            await File.WriteAllTextAsync(temp, System.Text.Json.JsonSerializer.Serialize(job, MapCatalogService.JsonOptions), ct);
            File.Move(temp, path, overwrite: true);
        }
        finally { _saveLock.Release(); }
    }
}
