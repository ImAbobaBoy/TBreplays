using Microsoft.AspNetCore.Authorization;
using TBReplays.Online;
using Microsoft.AspNetCore.Mvc;
using TBReplays.Maps;
using TBReplays.Maps.Calibration;

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
    public IActionResult Texture(string mapId, string fileName) => PhysicalFile(_mapImportService.GetTexturePath(mapId, fileName), "image/vnd-ms.dds", enableRangeProcessing: true);

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

        return PhysicalFile(
            chunkPath,
            "application/octet-stream",
            enableRangeProcessing: true);
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

        return PhysicalFile(
            path,
            "application/octet-stream",
            enableRangeProcessing: true);
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

        return PhysicalFile(
            path,
            "image/vnd-ms.dds",
            enableRangeProcessing: true);
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
