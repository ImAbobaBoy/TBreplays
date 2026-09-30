using Microsoft.AspNetCore.Mvc;
using TBReplays.Online;

namespace TBReplays.Controllers;

[ApiController, Route("api/sketch")]
public sealed class SketchController(SketchService sketches, OnlineConnections connections, ReplaySyncService replays) : ControllerBase
{
    [HttpGet]
    public async Task<SketchState> Get(CancellationToken ct) => await sketches.GetAsync(ct);

    [HttpGet("users")]
    public IReadOnlyList<UserDto> Users() => connections.List();

    [HttpPost("commands"), RequestSizeLimit(512 * 1024)]
    public async Task<IActionResult> Apply(SketchCommand command, CancellationToken ct)
    {
        var result = await sketches.ApplyAsync(User, command, ct);
        if (result.Applied && result.Change?.Kind == "setMap") await replays.MapChangedAsync();
        return result.Applied ? Ok(result) : result.Error switch
        {
            "unauthorized" => Unauthorized(result),
            "forbidden" => StatusCode(403, result),
            "revisionConflict" or "mapConflict" or "operationIdConflict" => Conflict(result),
            "notFound" => NotFound(result),
            _ => BadRequest(result)
        };
    }
}
