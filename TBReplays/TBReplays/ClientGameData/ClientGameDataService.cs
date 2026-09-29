namespace TBReplays.ClientGameData;

public sealed class ClientGameDataService
{
    private readonly ClientGameDataLoader _loader;
    private readonly SemaphoreSlim _loadLock = new(1, 1);
    private ClientGameDataCatalog? _catalog;

    public ClientGameDataService(ClientGameDataLoader loader)
    {
        _loader = loader;
    }

    public async Task<ClientGameDataCatalog> GetCatalogAsync(
        CancellationToken cancellationToken)
    {
        if (_catalog is not null)
        {
            return _catalog;
        }

        await _loadLock.WaitAsync(cancellationToken);
        try
        {
            _catalog ??= _loader.Load();
            return _catalog;
        }
        finally
        {
            _loadLock.Release();
        }
    }

    public async Task<ClientGameDataCatalog> ReloadAsync(
        CancellationToken cancellationToken)
    {
        await _loadLock.WaitAsync(cancellationToken);
        try
        {
            _catalog = _loader.Load();
            return _catalog;
        }
        finally
        {
            _loadLock.Release();
        }
    }
}
