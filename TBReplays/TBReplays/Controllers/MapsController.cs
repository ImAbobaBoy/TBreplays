using Microsoft.AspNetCore.Mvc;
using TBReplays.Maps;

namespace TBReplays.Controllers;

[ApiController]
[Route("api/maps")]
public sealed class MapsController : ControllerBase
{
    private readonly MapImportService _mapImportService;

    public MapsController(MapImportService mapImportService)
    {
        _mapImportService = mapImportService;
    }

    [HttpPost("import")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(1024L * 1024L * 1024L)]
    public async Task<ActionResult<MapImportResultDto>> Import(
        IFormFile archive,
        CancellationToken cancellationToken)
    {
        var result = await _mapImportService.ImportAsync(archive, cancellationToken);

        return Ok(result);
    }

    [HttpPost("import-local")]
    public async Task<ActionResult<MapImportResultDto>> ImportLocal(
        [FromQuery] string? archiveFileName,
        CancellationToken cancellationToken)
    {
        var result = await _mapImportService.ImportFromLocalArchiveAsync(
            archiveFileName,
            cancellationToken);

        return Ok(result);
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
}