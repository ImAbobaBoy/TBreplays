using Microsoft.AspNetCore.Authorization;
using TBReplays.Online;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using TBReplays.Replays;

namespace TBReplays.Controllers;

[ApiController]
[Route("api/replays")]
public sealed class ReplaysController : ControllerBase
{
    private readonly ReplayImportService _replayImportService;
    private readonly ReplaySessionService _replaySessionService;

    public ReplaysController(
        ReplayImportService replayImportService,
        ReplaySessionService replaySessionService)
    {
        _replayImportService = replayImportService;
        _replaySessionService = replaySessionService;
    }

    [Authorize(Roles = OnlineRoles.Admin)]
    [HttpPost("import-local")]
    public async Task<ActionResult<ReplayImportItemResultDto>> ImportLocal(
        [FromQuery] string? replayFileName,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await _replayImportService.ImportLocalAsync(
                replayFileName,
                cancellationToken);

            return Ok(result);
        }
        catch (Exception exception) when (exception is FileNotFoundException
                                           or DirectoryNotFoundException
                                           or InvalidDataException
                                           or InvalidOperationException
                                           or IOException
                                           or JsonException
                                           or UnauthorizedAccessException)
        {
            return BadRequest(exception.Message);
        }
    }

    [HttpPost("import")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(1024L * 1024L * 1024L)]
    [RequestFormLimits(MultipartBodyLengthLimit = 1024L * 1024L * 1024L)]
    public async Task<ActionResult<ReplayImportBatchResultDto>> Import(
        [FromForm] List<IFormFile>? files,
        CancellationToken cancellationToken)
    {
        if (files is null || files.Count == 0)
        {
            return BadRequest("Нужно передать хотя бы один .tbreplay файл в поле files.");
        }

        var items = new List<ReplayImportItemResultDto>();

        foreach (var file in files)
        {
            var safeFileName = Path.GetFileName(file.FileName);

            try
            {
                if (file.Length == 0)
                {
                    items.Add(ReplayImportItemResultDto.Failed(
                        safeFileName,
                        "Файл пустой."));

                    continue;
                }

                await using var stream = file.OpenReadStream();
                var item = await _replayImportService.ImportAsync(
                    stream,
                    safeFileName,
                    cancellationToken);

                items.Add(item);
            }
            catch (Exception exception) when (exception is FileNotFoundException
                                               or DirectoryNotFoundException
                                               or InvalidDataException
                                               or InvalidOperationException
                                               or IOException
                                               or JsonException
                                               or UnauthorizedAccessException)
            {
                items.Add(ReplayImportItemResultDto.Failed(
                    safeFileName,
                    exception.Message));
            }
        }

        return Ok(new ReplayImportBatchResultDto
        {
            Items = items
        });
    }

    [HttpGet("session/current")]
    public async Task<ActionResult<IReadOnlyList<ReplaySessionItemDto>>> GetCurrentSession(
        [FromQuery] string? mapName,
        CancellationToken cancellationToken)
    {
        var result = await _replaySessionService.GetCurrentSessionAsync(
            mapName,
            cancellationToken);

        return Ok(result);
    }

    [HttpGet("{replayId}/presentation")]
    public async Task<ActionResult<ReplayPresentationDto>> GetPresentation(
        string replayId, CancellationToken cancellationToken)
    {
        try
        {
            var result = await _replayImportService.GetParseResultAsync(replayId, cancellationToken);
            if (result.SchemaVersion < 2)
                return Conflict("Реплей обработан старой версией парсера. Импортируйте исходный .tbreplay повторно.");
            return Ok(ReplayPresentationDto.FromResult(result));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return NotFound(exception.Message);
        }
    }

    [HttpGet("{replayId}/parse-result")]
    public async Task<ActionResult<ReplayParseResult>> GetParseResult(
        string replayId,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await _replayImportService.GetParseResultAsync(
                replayId,
                cancellationToken);

            return Ok(result);
        }
        catch (Exception exception) when (exception is FileNotFoundException
                                           or InvalidDataException
                                           or IOException
                                           or UnauthorizedAccessException
                                           or JsonException)
        {
            return NotFound(exception.Message);
        }
    }

}
