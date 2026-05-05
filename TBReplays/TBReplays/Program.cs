using System.Text.Json;
using TBReplays.Dvpl;
using TBReplays.Maps;
using TBReplays.Replays;
using TBReplays.Sc2;
using TBReplays.Scg;
using TBReplays.Terrain;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

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
            .WithOrigins(
                "http://localhost:5173",
                "http://localhost:3000",
                "http://localhost:4200")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<DvplDecoder>();
builder.Services.AddSingleton<DavaHeightmapReader>();
builder.Services.AddSingleton<TerrainChunkExporter>();

builder.Services.AddSingleton<Sc2SceneReader>();
builder.Services.AddSingleton<Sc2MapObjectExtractor>();

builder.Services.AddSingleton<ScgPolygonGroupReader>();
builder.Services.AddSingleton<ScgMapMeshExportService>();

builder.Services.AddSingleton<MapImportService>();

builder.Services.AddSingleton<ReplayMovementCsvParser>();
builder.Services.AddSingleton<ReplayMovementImportService>();

builder.Services.AddSingleton<ReplayParseService>();
builder.Services.AddSingleton<ReplayParseLocalService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("WebClient");

app.MapControllers();

app.Run();