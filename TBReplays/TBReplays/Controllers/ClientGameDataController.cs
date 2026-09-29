using Microsoft.AspNetCore.Authorization;
using TBReplays.Online;
using Microsoft.AspNetCore.Mvc;
using TBReplays.ClientGameData;

namespace TBReplays.Controllers;

[ApiController]
[Route("api/client-game-data")]
public sealed class ClientGameDataController : ControllerBase
{
    private readonly ClientGameDataService _clientGameDataService;

    public ClientGameDataController(ClientGameDataService clientGameDataService)
    {
        _clientGameDataService = clientGameDataService;
    }

    [HttpGet("summary")]
    public async Task<ActionResult<ClientGameDataSummaryDto>> GetSummary(
        CancellationToken cancellationToken)
    {
        var catalog = await _clientGameDataService.GetCatalogAsync(cancellationToken);
        var summary = ClientGameDataSummaryMapper.ToSummaryDto(catalog);

        return Ok(summary);
    }

    [Authorize(Roles = OnlineRoles.Admin)]
    [HttpPost("reload")]
    public async Task<ActionResult<ClientGameDataSummaryDto>> Reload(
        CancellationToken cancellationToken)
    {
        var catalog = await _clientGameDataService.ReloadAsync(cancellationToken);
        var summary = ClientGameDataSummaryMapper.ToSummaryDto(catalog);

        return Ok(summary);
    }
}
