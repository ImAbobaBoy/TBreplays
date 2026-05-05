using Microsoft.AspNetCore.Mvc;
using TBReplays.Replays;

namespace TBReplays.Controllers;

[ApiController]
[Route("api/replays")]
public sealed class ReplaysController : ControllerBase
{
    private readonly ReplayMovementImportService _replayMovementImportService;
    private readonly ReplayParseLocalService _replayParseLocalService;

    public ReplaysController(
        ReplayMovementImportService replayMovementImportService,
        ReplayParseLocalService replayParseLocalService)
    {
        _replayMovementImportService = replayMovementImportService;
        _replayParseLocalService = replayParseLocalService;
    }

    [HttpPost("import-local")]
    public async Task<ActionResult<ReplayMovementImportResultDto>> ImportLocal(
        [FromQuery] string? archiveFileName,
        CancellationToken cancellationToken)
    {
        var result = await _replayMovementImportService.ImportFromLocalArchiveAsync(
            archiveFileName,
            cancellationToken);

        return Ok(result);
    }

    [HttpGet("{replayId}/movements")]
    public async Task<ActionResult<ReplayMovementSetDto>> GetMovements(
        string replayId,
        CancellationToken cancellationToken)
    {
        var result = await _replayMovementImportService.GetMovementsAsync(
            replayId,
            cancellationToken);

        return Ok(result);
    }
    
    [HttpPost("parse-local")]
    public async Task<ActionResult<ReplayParseLocalResultDto>> ParseLocal(
        [FromQuery] string? replayFileName,
        CancellationToken cancellationToken)
    {
        var result = await _replayParseLocalService.ParseLocalAsync(
            replayFileName,
            cancellationToken);

        return Ok(result);
    }

    [HttpGet("{replayId}/parse-result")]
    public async Task<ActionResult<ReplayParseResult>> GetParseResult(
        string replayId,
        CancellationToken cancellationToken)
    {
        var result = await _replayParseLocalService.GetParseResultAsync(
            replayId,
            cancellationToken);

        return Ok(result);
    }
}