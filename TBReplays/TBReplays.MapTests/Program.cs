using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using TBReplays.Dvpl;
using TBReplays.Maps;
using TBReplays.Maps.Calibration;
using TBReplays.Replays;
using TBReplays.Sc2;
using TBReplays.Scg;
using TBReplays.Terrain;
using TBReplays.ClientGameData;
using TBReplays.Replays.Parser;

if (args.Contains("--replay-shots-only")) {
    var payload = new byte[37];
    BinaryPrimitives.WriteUInt32LittleEndian(payload, 1);
    BinaryPrimitives.WriteUInt32LittleEndian(payload.AsSpan(4), 10);
    BinaryPrimitives.WriteSingleLittleEndian(payload.AsSpan(21), 800);
    EntityMethodFrame Frame(byte[] data, uint method = 35) => new(0, 0, 1, 1, method, data);
    if (EntityMethodPacketDecoder.TryDecodeShotFired(Frame(payload)) is null) throw new Exception("Legacy fire packet rejected");
    var extended = payload.Concat(new byte[8]).ToArray();
    if (EntityMethodPacketDecoder.TryDecodeShotFired(Frame(extended), 45) is null) throw new Exception("26.10 fire packet rejected");
    foreach (var length in new[] { 0, 36, 38, 44, 46 })
        if (EntityMethodPacketDecoder.TryDecodeShotFired(Frame(new byte[length]), 45) is not null) throw new Exception("Wrong fire payload accepted");
    if (EntityMethodPacketDecoder.TryDecodeShotFired(Frame(extended)) is not null
        || EntityMethodPacketDecoder.TryDecodeShotFired(Frame(extended, 55), 45) is not null) throw new Exception("Wrong fire profile accepted");
    BinaryPrimitives.WriteSingleLittleEndian(extended.AsSpan(9), float.NaN);
    if (EntityMethodPacketDecoder.TryDecodeShotFired(Frame(extended), 45) is not null) throw new Exception("Nonfinite shot accepted");
    var emptyCatalog = new ClientGameDataCatalog { Version = "26.10.0_ruby", RootPath = "", Localization = new Dictionary<string,string>(),
        VehiclesByDescriptor = new Dictionary<int,VehicleDefinition>(), VehiclesByKey = new Dictionary<string,VehicleDefinition>(),
        ExtrasByKey = new Dictionary<string,ExtraDefinition>(), ExtrasByRuntimeId = new Dictionary<int,ExtraDefinition>(),
        ModulesByRuntimeId = new Dictionary<int,ModuleDefinition>(), Warnings = [] };
    foreach (var path in args.Where(arg => arg.EndsWith(".tbreplay", StringComparison.OrdinalIgnoreCase))) {
        using var stream = File.OpenRead(path);
        var result = new ReplayParseService().Parse(stream, emptyCatalog);
        if (result.ShotEvents.Count == 0 || result.Playback.Vehicles.Sum(vehicle => vehicle.Shots.Count) != result.ShotEvents.Count
            || result.ProjectilePoints.Count == 0) throw new Exception("Real fire events lost in parse or presentation: " + path);
        Console.WriteLine($"PASS: {Path.GetFileName(path)}, {result.ShotEvents.Count} shots, {result.ProjectilePoints.Count} projectile points");
    }
    Console.WriteLine("PASS: 37/45-byte fire packets, version gating, invalid payload rejection, full parser/presentation path");
    return;
}

if (args.Contains("--replay-calibration-only"))
{
    var directory = Path.Combine(Path.GetTempPath(), "replay-calibration-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(directory);
    try {
        var calibrationJsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var service = new MapCalibrationService();
        var identity = new MapCalibrationCoordinateTransformDto(false, false, false, 0);
        var original = new MapCalibrationDto("canal", "canal", "canal", new(300),
            new(.001f, 0, "scene-landscape-bbox", 1, null), new(false, false, true, 0), identity,
            new(0), new(0, false, false), new(null, null, null, []), new(2, 1, 0, 65535, 0, 0, 65535));
        async Task CheckTransform(MapCalibrationDto source, MapCalibrationCoordinateTransformDto expected) {
            await File.WriteAllTextAsync(Path.Combine(directory, "map_calibration.json"), JsonSerializer.Serialize(source, calibrationJsonOptions));
            var read = await service.ReadAsync(directory, CancellationToken.None);
            if (read.ReplayTransform != expected) throw new Exception("Replay transform migration changed the wrong calibration");
            var stored = JsonSerializer.Deserialize<MapCalibrationDto>(await File.ReadAllTextAsync(Path.Combine(directory, "map_calibration.json")), calibrationJsonOptions)!;
            if (stored != source && stored.ReplayTransform != source.ReplayTransform) throw new Exception("Read rewrote original file");
        }
        await CheckTransform(original, new(false, false, true, 0));
        var manual = new MapCalibrationCoordinateTransformDto(false, true, false, 180);
        await CheckTransform(original with { ReplayTransform = manual }, manual);
        await CheckTransform(original with { Height = original.Height with { Source = "replay-fit" } }, identity);
        await CheckTransform(original with { ReplayTransform = new(false, false, true, 0) }, new(false, false, true, 0));
        await service.SaveAsync(directory, original, CancellationToken.None);
        var explicitIdentity = await service.ReadAsync(directory, CancellationToken.None);
        if (explicitIdentity.ReplayTransform != identity || explicitIdentity.ReplayCoordinateSystemVersion != 1)
            throw new Exception("Explicitly saved identity transform was overwritten by migration");
        Console.WriteLine("PASS: scene replay axis repair, manual/legacy calibration preservation, no disk rewrite.");
    } finally { Directory.Delete(directory, true); }
    return;
}

if (args.Contains("--texture-only"))
{
    byte[] PackedPvr(ulong format, ushort pixel)
    {
        var data = new byte[54];
        BinaryPrimitives.WriteUInt32LittleEndian(data, 0x03525650);
        BinaryPrimitives.WriteUInt64LittleEndian(data.AsSpan(8), format);
        foreach (var offset in new[] { 24, 28, 32, 36, 40, 44 }) BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(offset), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(data.AsSpan(52), pixel);
        return data;
    }
    var rgba = MapTextureConverter.ToDds(PackedPvr(0x0404040461626772, 0x1234));
    if (!rgba.AsSpan(128).SequenceEqual(new byte[] { 17, 34, 51, 68 })) throw new Exception("RGBA4444 channel order is wrong");
    var rgb = MapTextureConverter.ToDds(PackedPvr(0x0005060500626772, 0xf800));
    if (!rgb.AsSpan(128).SequenceEqual(new byte[] { 255, 0, 0, 255 })) throw new Exception("RGB565 red/blue order is wrong");
    var blue = MapTextureConverter.ToDds(PackedPvr(0x0005060500626772, 0x001f));
    if (!blue.AsSpan(128).SequenceEqual(new byte[] { 0, 0, 255, 255 })) throw new Exception("RGB565 blue/red order is wrong");
    try { MapTextureConverter.ToDds(PackedPvr(0x0404040461626772, 0x1234)[..^1]); throw new Exception("Truncated PVR accepted"); }
    catch (InvalidDataException) { }
    Console.WriteLine("PASS: packed PVR RGBA4444, RGB565 red/blue, truncated payload rejection.");
    return;
}
if (args.Length < 2) throw new ArgumentException("Usage: <Maps_game> <isolated output directory> [localization path] [--all]");
var source = Path.GetFullPath(args[0]); var output = Path.GetFullPath(args[1]);
if (args.Contains("--resume-import"))
{
    // Explicit maintenance mode: use the real configured map data directory, not test fixtures.
    if (source == output || source.StartsWith(output + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        throw new ArgumentException("Map data directory must not contain the source maps.");
    var runtimeEnv = new TestEnvironment { ContentRootPath = Directory.GetParent(source)!.FullName };
    var runtimeOptions = Options.Create(new MapImportOptions { SourceDirectory = source, DataDirectory = output,
        LocalizationPath = args.Length > 2 && !args[2].StartsWith("--") ? Path.GetFullPath(args[2]) : null });
    var runtimeCatalog = new MapCatalogService(runtimeEnv, runtimeOptions);
    var runtimeDecoder = new DvplDecoder(); var runtimeScenes = new Sc2SceneReader();
    var runtimeImporter = new MapDirectoryImporter(runtimeEnv, runtimeOptions, runtimeDecoder, runtimeScenes, new TerrainChunkExporter(),
        new ScgMapMeshExportService(runtimeDecoder, runtimeScenes, new ScgPolygonGroupReader()), runtimeCatalog, new MapCalibrationService());
    using var runtimeWorker = new MapImportWorker(runtimeImporter, runtimeEnv);
    await runtimeWorker.StartAsync(CancellationToken.None);
    var runtimeJob = runtimeWorker.Start(false);
    Console.WriteLine($"Resume job {runtimeJob.JobId}; output={runtimeCatalog.DataRoot}");
    using var runtimeDeadline = new CancellationTokenSource(TimeSpan.FromMinutes(10));
    while (runtimeWorker.Get(runtimeJob.JobId)?.Status is "queued" or "running") await Task.Delay(200, runtimeDeadline.Token);
    var runtimeCompleted = runtimeWorker.Get(runtimeJob.JobId)!;
    await runtimeWorker.StopAsync(CancellationToken.None);
    foreach (var item in runtimeCompleted.Maps) Console.WriteLine($"{item.Name}: {item.Status} {item.Error}");
    Console.WriteLine($"Job {runtimeCompleted.Status}; published={(await runtimeCatalog.ListAsync(CancellationToken.None)).Length}");
    if (runtimeCompleted.Status != "completed") Environment.ExitCode = 1;
    return;
}
if (args.Contains("--storage-only"))
{
    Directory.CreateDirectory(output);
    var storageFixture = Path.Combine(output, "storage-fixture-" + Guid.NewGuid().ToString("N"));
    var checkout = Path.Combine(storageFixture, "checkout"); Directory.CreateDirectory(checkout);
    var env = new TestEnvironment { ContentRootPath = checkout };
    var fixtureSource = Path.Combine(storageFixture, "source", "07_fort_ft"); Directory.CreateDirectory(fixtureSource);
    File.WriteAllText(Path.Combine(fixtureSource, "07_fort_ft.sc2.dvpl"), "discovery-only fixture");
    var config = Options.Create(new MapImportOptions { SourceDirectory = Directory.GetParent(fixtureSource)!.FullName, DataDirectory = Path.Combine(storageFixture, "external-data") });
    var storageCatalog = new MapCatalogService(env, config);
    var decoderForStorage = new DvplDecoder(); var scenesForStorage = new Sc2SceneReader();
    var storageImporter = new MapDirectoryImporter(env, config, decoderForStorage, scenesForStorage, new TerrainChunkExporter(),
        new ScgMapMeshExportService(decoderForStorage, scenesForStorage, new ScgPolygonGroupReader()), storageCatalog, new MapCalibrationService());
    void Assert(bool value, string label) { if (!value) throw new Exception(label); }
    try
    {
        const string name = "07_fort_ft", oldRevision = "00000000000000000000-11111111", newRevision = "11111111111111111111-22222222";
        var revisions = Path.Combine(storageCatalog.DataRoot, "Processed", name, "revisions");
        foreach (var revision in new[] { oldRevision, newRevision })
        {
            var directory = Path.Combine(revisions, revision); Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "manifest.json"), "{}");
            File.WriteAllBytes(Path.Combine(directory, "objects_mesh.bin"), [1, 2, 3]);
        }
        await storageCatalog.PublishAsync(new(name, "Форт", ["fort", name], newRevision, "hash", 4, DateTimeOffset.UtcNow, []), CancellationToken.None);
        Assert(storageCatalog.GetProcessedDirectory(name).StartsWith(config.Value.DataDirectory), "External directory resolution");
        var service = new MapImportService(storageCatalog, new MapCalibrationService());
        Assert(service.GetObjectMeshPath(name) == Path.Combine(revisions, newRevision, "objects_mesh.bin"), "Read artifacts from external data");
        var binding = await new ReplayMapBindingService(env, storageCatalog).BindAsync("fort", null, CancellationToken.None);
        Assert(binding.MatchedBackendMapId == name, "Replay aliases use external catalog");
        Assert(storageCatalog.GetProcessedDirectory(name + "-1234abcd") == storageCatalog.GetProcessedDirectory(name), "Legacy URL uses external storage");
        try { storageImporter.PruneRevisions(name, oldRevision); throw new Exception("Unpublished revision allowed for cleanup"); }
        catch (IOException) { Assert(Directory.Exists(Path.Combine(revisions, newRevision)), "Rejected cleanup preserves active revision"); }
        storageImporter.PruneRevisions(name, newRevision);
        Assert(!Directory.Exists(Path.Combine(revisions, oldRevision)) && Directory.Exists(Path.Combine(revisions, newRevision)), "Keep active revision, remove old");
        Assert(!Directory.Exists(Path.Combine(checkout, "Data")), "No map writes in checkout");
        config.Value.MinimumFreeSpaceGiB = double.MaxValue;
        using var worker = new MapImportWorker(storageImporter, env);
        try { worker.Start(false); throw new Exception("Low-space job accepted"); }
        catch (IOException e) { Assert(e.Message.Contains("Недостаточно места для импорта"), "Refused specifically for low disk space"); }
        Assert(!Directory.Exists(Path.Combine(checkout, "Data")), "Low-space refusal does not write to checkout");
        config.Value.SourceDirectory = storageCatalog.DataRoot;
        try
        {
            _ = new MapDirectoryImporter(env, config, decoderForStorage, scenesForStorage, new TerrainChunkExporter(),
                new ScgMapMeshExportService(decoderForStorage, scenesForStorage, new ScgPolygonGroupReader()), storageCatalog, new MapCalibrationService());
            throw new Exception("Source/output overlap accepted");
        }
        catch (InvalidOperationException e) { Assert(e.Message.Contains("Исходники доступны только для чтения"), "Overlap refused specifically for source protection"); }
        Assert(File.ReadAllText(Path.Combine(fixtureSource, "07_fort_ft.sc2.dvpl")) == "discovery-only fixture", "Source files untouched");
        Console.WriteLine("PASS: external storage, artifact reads, replay aliases, legacy URLs, retention, low-space refusal, source protection.");
    }
    finally { Directory.Delete(storageFixture, recursive: true); }
    return;
}
if (output == source || source.StartsWith(output + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Output must not contain source.");
Directory.CreateDirectory(output);
var environment = new TestEnvironment { ContentRootPath = output };
var options = Options.Create(new MapImportOptions { SourceDirectory = source, LocalizationPath = args.Length > 2 ? Path.GetFullPath(args[2]) : null });
var decoder = new DvplDecoder(); var scenes = new Sc2SceneReader(); var reader = new ScgPolygonGroupReader();
var catalog = new MapCatalogService(environment); var calibration = new MapCalibrationService();
var importer = new MapDirectoryImporter(environment, options, decoder, scenes, new TerrainChunkExporter(), new ScgMapMeshExportService(decoder, scenes, reader), catalog, calibration);
int checks = 0;
void Check(bool test, string message) { if (!test) throw new InvalidOperationException(message); checks++; }
var packed = File.ReadAllBytes(Path.Combine(source, "07_fort_ft", "07_fort_ft.scg.dvpl")); packed[^12] ^= 1;
try { decoder.Decode(packed); throw new Exception("CRC mutation accepted"); } catch (InvalidDataException) { checks++; }
var directories = importer.Discover();
Check(directories.Length >= 5 && directories.All(d => !Path.GetFileName(d).StartsWith("00_")), "Map discovery");
var wanted = new[] { "07_fort_ft", "08_idle_id", "02_desert_train_dt", "05_amigosville_am", "03_erlenberg_er" };
if (!args.Contains("--all")) directories = directories.Where(d => wanted.Contains(Path.GetFileName(d))).ToArray();
await importer.PrepareBatchAsync(CancellationToken.None);
var clock = Stopwatch.StartNew(); var results = new List<MapImportItem>();
await Parallel.ForEachAsync(directories, new ParallelOptions { MaxDegreeOfParallelism = 2 }, async (directory, ct) =>
{
    var result = await importer.ImportAsync(directory, false, ct); lock (results) results.Add(result);
    Console.WriteLine($"{result.Name}: {result.Status} {result.DurationMs}ms warnings={result.Warnings?.Count} {result.Error}");
});
File.WriteAllText(Path.Combine(output, "test-results.json"), JsonSerializer.Serialize(results, MapCatalogService.JsonOptions));
Check(results.All(x => x.Status != "failed"), "One or more real maps failed; see test-results.json");
foreach (var map in await catalog.ListAsync(CancellationToken.None))
{
    var dir = catalog.GetProcessedDirectory(map.Name);
    var parsed = new MapScene(scenes.Read(decoder.DecodeFile(Path.Combine(source, map.Name, map.Name + ".sc2.dvpl"))));
    var c = await calibration.ReadAsync(dir, CancellationToken.None);
    Check(MathF.Abs(c.Height.Scale * 65535 - (parsed.Bounds[5] - parsed.Bounds[2])) < 0.0001f, "Source bbox height: " + map.Name);
    Check(c.Height.Source == "scene-landscape-bbox" && c.MapId == map.Name, "Stable map name / source height");
    using var m = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "objects_mesh_manifest.json")));
    var vc = m.RootElement.GetProperty("vertexCount").GetInt32(); var ic = m.RootElement.GetProperty("indexCount").GetInt32();
    Check(ic > 0 && ic % 3 == 0, "Triangle-list index count");
    using var binary = new BinaryReader(File.OpenRead(Path.Combine(dir, "objects_mesh.bin")));
    Check(binary.ReadInt32() == 0x324a424f && binary.ReadInt32() == 3 && binary.ReadInt32() == vc && binary.ReadInt32() == ic, "OBJ2/v3 header");
    var draws = binary.ReadInt32();
    for (int i = 0; i < draws; i++) { var start = binary.ReadInt32(); var count = binary.ReadInt32(); var material = binary.ReadInt32(); Check(start % 3 == 0 && count % 3 == 0 && start + count <= ic && material >= 0, "Draw boundaries"); }
    for (int i = 0; i < vc * 8; i++) Check(float.IsFinite(binary.ReadSingle()), "Finite vertex attribute");
    for (int i = 0; i < ic; i++) Check(binary.ReadUInt32() < vc, "Index bounds");
    Check(binary.BaseStream.Position == binary.BaseStream.Length, "Binary length");
    var binding = await new ReplayMapBindingService(environment).BindAsync(map.ReplayMapNames[0], null, CancellationToken.None);
    Check(binding.MatchedBackendMapId == map.Name, "Replay alias binding");
    Check(catalog.GetProcessedDirectory(map.Name + "-1234abcd") == dir, "Legacy UUID link alias");
    if (map.Name == "07_fort_ft")
    {
        var names = m.RootElement.GetProperty("instances").EnumerateArray().Select(x => x.GetProperty("name").GetString()).ToArray();
        Check(names.Any(n => n == "env_ft_barn.sc2 State 0") && !names.Any(n => n == "env_ft_barn.sc2 State 1"), "Only active barn state");
    }
    if (map.Name == "08_idle_id")
    {
        using var texture = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "terrain_texture_manifest.json")));
        Check(texture.RootElement.GetProperty("fileName").GetString() == "landscape/idleColorTexture.tex", "Yukon color slot, not flowers");
        Check(File.ReadAllBytes(Path.Combine(dir, "terrain_color.dds")).AsSpan(0, 4).SequenceEqual("DDS "u8), "PVR conversion");
    }
}
await importer.PrepareBatchAsync(CancellationToken.None);
foreach (var directory in directories) Check((await importer.ImportAsync(directory, false, CancellationToken.None)).Status == "unchanged", "Incremental import");
Check(!Directory.EnumerateDirectories(Path.Combine(output, "Data", "Processed"), "staging-*", SearchOption.AllDirectories).Any(), "No leaked staging");
var geometrySource = decoder.DecodeFile(Path.Combine(source, "07_fort_ft", "07_fort_ft.scg.dvpl"));
var expectedGroups = reader.Read(geometrySource).Count;
var concurrentReads = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => Task.Run(() => reader.Read(geometrySource).Count)));
Check(concurrentReads.All(n => n == expectedGroups), "Concurrent SCG reader");
var previousRevision = (await catalog.ListAsync(CancellationToken.None)).Single(x => x.Name == "07_fort_ft").Revision;
var fixtureRoot = Path.Combine(output, "invalid-map-fixture");
var fixture = Path.Combine(fixtureRoot, "07_fort_ft"); Directory.CreateDirectory(fixture);
var badScene = File.ReadAllBytes(Path.Combine(source, "07_fort_ft", "07_fort_ft.sc2.dvpl")); badScene[^12] ^= 1;
File.WriteAllBytes(Path.Combine(fixture, "07_fort_ft.sc2.dvpl"), badScene);
var failingImporter = new MapDirectoryImporter(environment, Options.Create(new MapImportOptions { SourceDirectory = fixtureRoot }), decoder, scenes,
    new TerrainChunkExporter(), new ScgMapMeshExportService(decoder, scenes, reader), catalog, calibration);
Check((await failingImporter.ImportAsync(fixture, true, CancellationToken.None)).Status == "failed", "Corrupted scene rejected");
Check((await catalog.ListAsync(CancellationToken.None)).Single(x => x.Name == "07_fort_ft").Revision == previousRevision, "Failed import preserves active revision");
// The fixture is generated by this test under the isolated output directory.
Directory.Delete(fixtureRoot, recursive: true);
using (var worker = new MapImportWorker(importer, environment))
{
    await worker.StartAsync(CancellationToken.None);
    var job = worker.Start(false);
    try { worker.Start(false); throw new Exception("Overlapping job accepted"); } catch (InvalidOperationException) { checks++; }
    using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(2));
    while (worker.Get(job.JobId)?.Status is "queued" or "running") await Task.Delay(100, deadline.Token);
    var completed = worker.Get(job.JobId)!;
    Check(completed.Status == "completed" && completed.Maps.Count == importer.Discover().Length, "Background batch completed");
    Check(completed.Maps.All(x => x.Status == "unchanged"), "Background incremental import");
    await worker.StopAsync(CancellationToken.None);
}
Console.WriteLine($"PASS {checks} checks; first pass {clock.Elapsed}; maps={directories.Length}.");

sealed class TestEnvironment : IWebHostEnvironment
{
    public string ContentRootPath { get; set; } = "";
    public string ApplicationName { get; set; } = "MapTests";
    public string EnvironmentName { get; set; } = "Testing";
    public string WebRootPath { get; set; } = "";
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
}
