using System.Text.Json;
using System.Text.Json.Nodes;

namespace TBReplays.Strategies;

public sealed class StrategySlideStorageService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    private static readonly JsonNode EmptySnapshot = JsonNode.Parse("""
        {
          "manualTanks": [],
          "selectedManualTankId": null,
          "strokes": []
        }
        """)!;

    private readonly IWebHostEnvironment _environment;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public StrategySlideStorageService(IWebHostEnvironment environment)
    {
        _environment = environment;
    }

    public async Task<IReadOnlyList<StrategySlideDto>> GetAllAsync(CancellationToken cancellationToken)
    {
        var directory = GetSlidesDirectory();

        if (!Directory.Exists(directory))
        {
            return [];
        }

        var slides = new List<StrategySlideDto>();

        foreach (var path in Directory.EnumerateFiles(directory, "*.json", SearchOption.TopDirectoryOnly))
        {
            var slide = await ReadSlideFromPathAsync(path, cancellationToken);

            if (slide is not null)
            {
                slides.Add(slide);
            }
        }

        return slides
            .OrderBy(x => x.CreatedAtUtc)
            .ThenBy(x => x.Title, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public async Task<StrategySlideDto> GetAsync(
        string slideId,
        CancellationToken cancellationToken)
    {
        var path = GetSlidePath(slideId);

        if (!File.Exists(path))
        {
            throw new FileNotFoundException("Strategy slide json не найден.", path);
        }

        var slide = await ReadSlideFromPathAsync(path, cancellationToken);

        return slide ?? throw new InvalidDataException("Strategy slide json повреждён.");
    }

    public async Task<StrategySlideDto> CreateAsync(
        CreateStrategySlideRequest request,
        CancellationToken cancellationToken)
    {
        var mapId = request.MapId.Trim();
        var title = request.Title.Trim();

        if (string.IsNullOrWhiteSpace(mapId))
        {
            throw new InvalidDataException("MapId не может быть пустым.");
        }

        if (string.IsNullOrWhiteSpace(title))
        {
            title = $"{mapId}: новая стратегия";
        }

        var now = DateTimeOffset.UtcNow;
        var slide = new StrategySlideDto(
            Id: CreateSlideId(),
            MapId: mapId,
            Title: title,
            Snapshot: CloneEmptySnapshot(),
            CreatedAtUtc: now,
            UpdatedAtUtc: now,
            Revision: 1);

        await SaveSlideAsync(slide, cancellationToken);

        return slide;
    }

    public async Task<StrategySlideDto> SaveAsync(
        string slideId,
        StrategySlideDto request,
        CancellationToken cancellationToken)
    {
        var safeSlideId = NormalizeSlideId(slideId);
        var mapId = request.MapId.Trim();
        var title = request.Title.Trim();

        if (string.IsNullOrWhiteSpace(mapId))
        {
            throw new InvalidDataException("MapId не может быть пустым.");
        }

        if (string.IsNullOrWhiteSpace(title))
        {
            title = $"{mapId}: стратегия";
        }

        await _gate.WaitAsync(cancellationToken);

        try
        {
            var existing = await TryGetAsync(safeSlideId, cancellationToken);
            var now = DateTimeOffset.UtcNow;

            // TODO: Временное MVP-решение.
            // Сейчас стратегия сохраняется как отдельный json-файл slideId.json раз в несколько секунд с последней frontend-версией snapshot.
            // Потом заменить на StrategyDocument в нормальном persistence/backend session storage с optimistic concurrency по revision.
            // Убрать file-json storage, когда появится полноценное backend-сохранение стратегических разборов.
            var slide = new StrategySlideDto(
                Id: safeSlideId,
                MapId: mapId,
                Title: title,
                Snapshot: request.Snapshot?.DeepClone() ?? CloneEmptySnapshot(),
                CreatedAtUtc: existing?.CreatedAtUtc ?? request.CreatedAtUtc,
                UpdatedAtUtc: now,
                Revision: (existing?.Revision ?? request.Revision) + 1);

            if (slide.CreatedAtUtc == default)
            {
                slide = slide with
                {
                    CreatedAtUtc = now
                };
            }

            await WriteSlideFileAsync(slide, cancellationToken);

            return slide;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<StrategySlideDto?> TryGetAsync(
        string slideId,
        CancellationToken cancellationToken)
    {
        var path = GetSlidePath(slideId);

        if (!File.Exists(path))
        {
            return null;
        }

        return await ReadSlideFromPathAsync(path, cancellationToken);
    }

    private async Task SaveSlideAsync(
        StrategySlideDto slide,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);

        try
        {
            await WriteSlideFileAsync(slide, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task WriteSlideFileAsync(
        StrategySlideDto slide,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(GetSlidesDirectory());

        var path = GetSlidePath(slide.Id);
        var tempPath = path + $".{Guid.NewGuid():N}.tmp";
        var json = JsonSerializer.Serialize(slide, JsonOptions);

        await File.WriteAllTextAsync(tempPath, json, cancellationToken);
        File.Move(tempPath, path, overwrite: true);
    }

    private static async Task<StrategySlideDto?> ReadSlideFromPathAsync(
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);

        return await JsonSerializer.DeserializeAsync<StrategySlideDto>(
            stream,
            JsonOptions,
            cancellationToken);
    }

    private string GetSlidesDirectory()
    {
        return Path.Combine(_environment.ContentRootPath, "Data", "StrategySlides");
    }

    private string GetSlidePath(string slideId)
    {
        return Path.Combine(GetSlidesDirectory(), $"{NormalizeSlideId(slideId)}.json");
    }

    private static string NormalizeSlideId(string slideId)
    {
        var safeFileName = Path.GetFileNameWithoutExtension(slideId).Trim();

        if (string.IsNullOrWhiteSpace(safeFileName))
        {
            throw new InvalidDataException("SlideId не может быть пустым.");
        }

        return safeFileName;
    }

    private static string CreateSlideId()
    {
        return $"slide-{Guid.NewGuid():N}";
    }

    private static JsonNode CloneEmptySnapshot()
    {
        return EmptySnapshot.DeepClone();
    }
}
