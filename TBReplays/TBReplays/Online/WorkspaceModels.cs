namespace TBReplays.Online;

public sealed record WorkspaceSlide(string Id, string MapId, string Title);
public sealed record WorkspaceState(long Revision, IReadOnlyList<WorkspaceSlide> Slides,
    string? PresenterId, string? PresenterConnectionId, string? PresenterSlideId, string? ActiveSlideId = null);
public sealed record WorkspaceCommand(string OperationId, string Kind, long ExpectedRevision,
    string? SlideId = null, string? MapId = null, string? Title = null, string? SourceSlideId = null);
public sealed record WorkspaceResult(bool Applied, string? Error, WorkspaceState State);
public sealed class WorkspaceDocument
{
    public long Revision { get; set; }
    public List<WorkspaceSlide> Slides { get; set; } = [];
}
