using TBReplays.Online;
using System.Text.Json;
using TBReplays.ClientGameData;
using TBReplays.Dvpl;
using TBReplays.Maps;
using TBReplays.Maps.Calibration;
using TBReplays.Replays;
using TBReplays.Sc2;
using TBReplays.Scg;
using TBReplays.Terrain;
using Microsoft.AspNetCore.ResponseCompression;
using System.IO.Compression;

var builder = WebApplication.CreateBuilder(args);
// Machine-specific paths stay out of shared configuration and published builds.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables().AddCommandLine(args);

builder.Services.AddControllers();
builder.Services.AddResponseCompression(options => {
    options.EnableForHttps = true;
    options.Providers.Add<GzipCompressionProvider>();
    options.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(new[] { "application/octet-stream", "image/vnd-ms.dds" });
});
builder.Services.Configure<GzipCompressionProviderOptions>(options => options.Level = CompressionLevel.Fastest);
builder.AddOnline();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("WebClient", policy =>
    {
        policy
            .WithOrigins(builder.Configuration.GetSection("Online:AllowedOrigins").Get<string[]>() ?? [])
            .AllowCredentials()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.Configure<ClientGameDataOptions>(
    builder.Configuration.GetSection("ClientGameData"));

builder.Services.AddSingleton<DvplDecoder>();
builder.Services.AddSingleton<DvplTextFileReader>();
builder.Services.AddSingleton<ClientGameDataPathResolver>();
builder.Services.AddSingleton<ClientGameDataLoader>();
builder.Services.AddSingleton<ClientGameDataService>();

builder.Services.AddSingleton<DavaHeightmapReader>();
builder.Services.AddSingleton<TerrainChunkExporter>();
builder.Services.AddSingleton<MapCalibrationService>();

builder.Services.AddSingleton<Sc2SceneReader>();
builder.Services.AddSingleton<Sc2MapObjectExtractor>();

builder.Services.AddSingleton<ScgPolygonGroupReader>();
builder.Services.AddSingleton<ScgMapMeshExportService>();

builder.Services.AddSingleton<MapImportService>();
builder.Services.Configure<MapImportOptions>(builder.Configuration.GetSection("MapImport"));
builder.Services.AddSingleton<MapCatalogService>();
builder.Services.AddSingleton<MapDirectoryImporter>();
builder.Services.AddSingleton<MapImportWorker>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<MapImportWorker>());

builder.Services.AddSingleton<ReplayParseService>();
builder.Services.AddSingleton<ReplayMapBindingService>();
builder.Services.AddSingleton<ReplayImportService>();
builder.Services.AddSingleton<ReplaySessionService>();

var app = builder.Build();
// Compress large map artifacts without touching authenticated account responses.
app.UseWhen(context => HttpMethods.IsGet(context.Request.Method) && context.Request.Path.StartsWithSegments("/api/maps"),
    maps => maps.UseResponseCompression());

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

await app.InitializeOnlineAsync();
app.UseOnline();

app.MapControllers();

app.Run();
