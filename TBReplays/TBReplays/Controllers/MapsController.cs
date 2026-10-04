using Microsoft.AspNetCore.Authorization;
using TBReplays.Online;
using Microsoft.AspNetCore.Mvc;
using TBReplays.Maps;
using TBReplays.Maps.Calibration;
using Microsoft.Net.Http.Headers;
using System.Buffers.Binary;

namespace TBReplays.Controllers;

[ApiController]
[Route("api/maps")]
public sealed class MapsController : ControllerBase
{
    private readonly MapImportService _mapImportService;
    private readonly MapCatalogService _catalog;
    private readonly MapImportWorker _worker;

    public MapsController(MapImportService mapImportService, MapCatalogService catalog, MapImportWorker worker)
    {
        _mapImportService = mapImportService;
        _catalog = catalog;
        _worker = worker;
    }

    [HttpGet]
    public Task<MapCatalogEntry[]> List(CancellationToken cancellationToken) => _catalog.ListAsync(cancellationToken);

    [Authorize(Roles = OnlineRoles.Admin)]
    [HttpPost("import-all")]
    public ActionResult<MapImportJob> ImportAll([FromQuery] bool force = false)
    {
        try
        {
            var job = _worker.Start(force);
            return Accepted($"/api/maps/import-jobs/{job.JobId}", job);
        }
        catch (InvalidOperationException e) { return Conflict(new { error = e.Message }); }
        catch (IOException e) { return BadRequest(new { error = e.Message }); }
    }

    [Authorize(Roles = OnlineRoles.Admin)]
    [HttpGet("import-jobs/{jobId}")]
    public ActionResult<MapImportJob> ImportStatus(string jobId)
    {
        var job = _worker.Get(jobId);
        return job is null ? NotFound() : Ok(job);
    }

    [HttpGet("{mapId}/surface")]
    public Task<object> Surface(string mapId, CancellationToken cancellationToken) => _mapImportService.GetSurfaceAsync(mapId, cancellationToken);

    [HttpGet("{mapId}/textures/{fileName}")]
    public IActionResult Texture(string mapId, string fileName) => Artifact(_mapImportService.GetTexturePath(mapId, fileName), "image/vnd-ms.dds");

    private PhysicalFileResult Artifact(string path, string contentType) {
        var info = new FileInfo(path);
        Response.Headers.CacheControl = "private, max-age=0, must-revalidate";
        return new PhysicalFileResult(path, contentType) {
            EnableRangeProcessing = true, LastModified = info.LastWriteTimeUtc,
            EntityTag = new EntityTagHeaderValue($"\"{info.Length:x}-{info.LastWriteTimeUtc.Ticks:x}\"", isWeak: true)
        };
    }

    [HttpGet("{mapId}/terrain/chunks.bin")]
    public async Task GetTerrainChunks(string mapId, CancellationToken cancellationToken) {
        var manifest = await _mapImportService.GetManifestAsync(mapId, cancellationToken);
        var paths = manifest.Chunks.Select(chunk => _mapImportService.GetChunkPath(mapId, chunk.X, chunk.Y)).ToArray();
        // One streamed response replaces 16–64 round trips; no archive or temporary file is created.
        Response.ContentType = "application/octet-stream";
        var header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, paths.Length);
        await Response.Body.WriteAsync(header, cancellationToken);
        foreach (var path in paths) {
            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
            BinaryPrimitives.WriteInt32LittleEndian(header, checked((int)stream.Length));
            await Response.Body.WriteAsync(header, cancellationToken);
            await stream.CopyToAsync(Response.Body, cancellationToken);
        }
    }

    [HttpGet("{mapId}/manifest")]
    public async Task<ActionResult<MapManifestDto>> GetManifest(
        string mapId,
        CancellationToken cancellationToken)
    {
        var manifest = await _mapImportService.GetManifestAsync(mapId, cancellationToken);

        return Ok(manifest);
    }

    [HttpGet("{mapId}/terrain/chunks/{chunkX:int}/{chunkY:int}")]
    public IActionResult GetTerrainChunk(
        string mapId,
        int chunkX,
        int chunkY)
    {
        var chunkPath = _mapImportService.GetChunkPath(mapId, chunkX, chunkY);

        return Artifact(
            chunkPath,
            "application/octet-stream");
    }

    [HttpGet("{mapId}/objects")]
    public async Task<ActionResult<MapObjectSetDto>> GetObjects(
        string mapId,
        CancellationToken cancellationToken)
    {
        var objects = await _mapImportService.GetObjectsAsync(
            mapId,
            cancellationToken);

        return Ok(objects);
    }
    
    [HttpGet("{mapId}/object-mesh/manifest")]
    public async Task<ActionResult<MapObjectMeshManifestDto>> GetObjectMeshManifest(
        string mapId,
        CancellationToken cancellationToken)
    {
        var manifest = await _mapImportService.GetObjectMeshManifestAsync(
            mapId,
            cancellationToken);

        return Ok(manifest);
    }

    [HttpGet("{mapId}/object-mesh.bin")]
    public IActionResult GetObjectMesh(string mapId)
    {
        var path = _mapImportService.GetObjectMeshPath(mapId);

        return Artifact(
            path,
            "application/octet-stream");
    }
    
    [HttpGet("{mapId}/terrain/texture/manifest")]
    public async Task<ActionResult<TerrainTextureManifestDto>> GetTerrainTextureManifest(
        string mapId,
        CancellationToken cancellationToken)
    {
        var manifest = await _mapImportService.GetTerrainTextureManifestAsync(
            mapId,
            cancellationToken);

        return Ok(manifest);
    }

    [HttpGet("{mapId}/terrain/texture.dds")]
    public IActionResult GetTerrainTexture(string mapId)
    {
        var path = _mapImportService.GetTerrainTexturePath(mapId);

        return Artifact(
            path,
            "image/vnd-ms.dds");
    }
    
    [HttpGet("{mapId}/calibration")]
    public async Task<ActionResult<MapCalibrationDto>> GetCalibration(
        string mapId,
        CancellationToken cancellationToken)
    {
        var calibration = await _mapImportService.GetCalibrationAsync(
            mapId,
            cancellationToken);

        return Ok(calibration);
    }
    
    [Authorize(Roles = OnlineRoles.Admin)]
    [HttpPut("{mapId}/calibration")]
    public async Task<ActionResult<MapCalibrationDto>> SaveCalibration(
        string mapId,
        MapCalibrationDto calibration,
        CancellationToken cancellationToken)
    {
        var calibrationToSave = calibration with
        {
            MapId = mapId
        };

        var saved = await _mapImportService.SaveCalibrationAsync(
            mapId,
            calibrationToSave,
            cancellationToken);

        return Ok(saved);
    }
}
