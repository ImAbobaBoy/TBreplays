using Microsoft.AspNetCore.Authorization;
using TBReplays.Online;
using Microsoft.AspNetCore.Mvc;
using TBReplays.Strategies;

namespace TBReplays.Controllers;

[ApiController]
[Route("api/strategy-slides")]
public sealed class StrategySlidesController : ControllerBase
{
    private readonly StrategySlideStorageService _strategySlideStorageService;

    public StrategySlidesController(StrategySlideStorageService strategySlideStorageService)
    {
        _strategySlideStorageService = strategySlideStorageService;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<StrategySlideDto>>> GetAll(
        CancellationToken cancellationToken)
    {
        var slides = await _strategySlideStorageService.GetAllAsync(cancellationToken);

        return Ok(slides);
    }

    [HttpGet("{slideId}")]
    public async Task<ActionResult<StrategySlideDto>> Get(
        string slideId,
        CancellationToken cancellationToken)
    {
        var slide = await _strategySlideStorageService.GetAsync(
            slideId,
            cancellationToken);

        return Ok(slide);
    }

    [Authorize(Roles = OnlineRoles.Writers)]
    [HttpPost]
    public async Task<ActionResult<StrategySlideDto>> Create(
        CreateStrategySlideRequest request,
        CancellationToken cancellationToken)
    {
        var slide = await _strategySlideStorageService.CreateAsync(
            request,
            cancellationToken);

        return Ok(slide);
    }

    [Authorize(Roles = OnlineRoles.Writers)]
    [HttpPut("{slideId}")]
    public async Task<ActionResult<StrategySlideDto>> Save(
        string slideId,
        StrategySlideDto slide,
        CancellationToken cancellationToken)
    {
        var saved = await _strategySlideStorageService.SaveAsync(
            slideId,
            slide with
            {
                Id = slideId
            },
            cancellationToken);

        return Ok(saved);
    }
}
