using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

public sealed class WorkspaceService
{
    private readonly OnlineFiles _files;
    private readonly OnlineSecurity _security;
    private readonly OnlineConnections _connections;
    private readonly IHubContext<SketchHub> _hub;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private WorkspaceDocument _document;
    private string? _presenterId, _presenterConnection, _presenterSlide;
    private readonly Dictionary<string, (string UserId, WorkspaceCommand Command)> _operations = [];

    public WorkspaceService(OnlineFiles files, OnlineSecurity security, OnlineConnections connections, IHubContext<SketchHub> hub)
    {
        _files = files; _security = security; _connections = connections; _hub = hub;
        _document = files.Read("workspace.json", () => {
            var legacy = files.Read("sketch.json", () => new SketchDocument());
            return new WorkspaceDocument { Slides = legacy.MapId is null ? [] : [new("legacy", legacy.MapId, "Тактика 1")] };
        });
    }
    public static string Group(string slideId) => "slide:" + slideId;
    public WorkspaceSlide? Find(string id) => _document.Slides.FirstOrDefault(slide => slide.Id == id);
    public string? EffectiveSlide(string connectionId) => _presenterSlide ??
        (Find(_connections.LocalSlide(connectionId) ?? "")?.Id ?? _document.Slides.FirstOrDefault()?.Id);
    public bool CanAccess(string userId, string connectionId, string slideId) =>
        _connections.UserIdFor(connectionId) == userId && Find(slideId) is not null && EffectiveSlide(connectionId) == slideId;
    public WorkspaceState Get(string? connectionId = null) => new(_document.Revision, _document.Slides.ToArray(),
        _presenterId, _presenterConnection, _presenterSlide, connectionId is null ? null : EffectiveSlide(connectionId));

    public async Task<WorkspaceResult> SelectAsync(string connectionId, string slideId)
    {
        await _gate.WaitAsync();
        try {
            if (Find(slideId) is null) return new(false, "slideNotFound", Get(connectionId));
            if (_presenterConnection is not null && _presenterConnection != connectionId) {
                if (slideId != _presenterSlide) return new(false, "presentationActive", Get(connectionId));
                await JoinAsync(connectionId);
                return new(true, null, Get(connectionId));
            }
            _connections.SelectSlide(connectionId, slideId);
            if (_presenterConnection == connectionId && _presenterSlide != slideId) {
                _presenterSlide = slideId;
                _document = new() { Revision = _document.Revision + 1, Slides = _document.Slides };
                await PublishAsync();
            } else await JoinAsync(connectionId);
            return new(true, null, Get(connectionId));
        } finally { _gate.Release(); }
    }
    public async Task JoinAsync(string connectionId)
    {
        var old = _connections.JoinedSlide(connectionId);
        var next = EffectiveSlide(connectionId);
        if (old == next) return;
        if (old is not null) await _hub.Groups.RemoveFromGroupAsync(connectionId, Group(old));
        if (next is not null) await _hub.Groups.AddToGroupAsync(connectionId, Group(next));
        _connections.JoinSlide(connectionId, next);
    }
    public async Task<WorkspaceResult> ApplyAsync(ClaimsPrincipal principal, string connectionId, WorkspaceCommand command)
    {
        await _files.AccountGate.WaitAsync();
        try {
            var user = await _security.GetCurrentAsync(principal);
            await _gate.WaitAsync();
            try {
                WorkspaceResult Fail(string error) => new(false, error, Get(connectionId));
                if (user is null || _connections.UserIdFor(connectionId) != user.Id) return Fail("unauthorized");
                if (user.Role is not (OnlineRoles.Admin or OnlineRoles.Editor)) return Fail("forbidden");
                if (command is null || !Guid.TryParse(command.OperationId, out _)) return Fail("invalidCommand");
                if (_operations.TryGetValue(command.OperationId, out var operation))
                    return operation.UserId == user.Id && operation.Command == command ? new(true, null, Get(connectionId)) : Fail("operationIdConflict");
                if (command.ExpectedRevision != _document.Revision) return Fail("revisionConflict");
                if (_presenterConnection is not null && _presenterConnection != connectionId && command.Kind != "stopPresentation") return Fail("presentationActive");
                var slides = _document.Slides.ToList();
                if (command.Kind is "add" or "replace") {
                    if (!ValidId(command.SlideId) || command.SlideId == "legacy" || !ValidId(command.MapId)
                        || command.Kind == "add" && slides.Count >= 100 || Find(command.SlideId!) is not null
                        || File.Exists(Path.Combine(_files.DirectoryPath, "sketch-" + command.SlideId + ".json"))) return Fail("invalidSlide");
                    if (!ValidTitle(command.Title)) return Fail("invalidTitle");
                    var newSlide = new WorkspaceSlide(command.SlideId!, command.MapId!, command.Title!.Trim());
                    if (command.Kind == "replace") {
                        var index = slides.FindIndex(slide => slide.Id == command.SourceSlideId);
                        if (index < 0 || (_presenterConnection is not null && _presenterConnection != connectionId)) return Fail("slideNotFound");
                        slides[index] = newSlide;
                    } else {
                        if (command.SourceSlideId is not null) {
                            var source = Find(command.SourceSlideId);
                            if (source is null || source.MapId != command.MapId) return Fail("slideNotFound");
                            var copy = _files.Read(command.SourceSlideId == "legacy" ? "sketch.json" : "sketch-" + command.SourceSlideId + ".json", () => new SketchDocument { MapId = source.MapId });
                            copy.UndoHistory.Clear(); copy.RedoHistory.Clear(); copy.RecentOperations.Clear();
                            await _files.WriteAsync("sketch-" + newSlide.Id + ".json", copy, CancellationToken.None);
                        }
                        slides.Add(newSlide);
                    }
                    if (command.Kind == "replace" || command.SourceSlideId is null)
                        await _files.WriteAsync("sketch-" + newSlide.Id + ".json", new SketchDocument { MapId = newSlide.MapId }, CancellationToken.None);
                } else if (command.Kind is "delete" or "rename") {
                    if (Find(command.SlideId ?? "") is null) return Fail("slideNotFound");
                    if (_presenterConnection is not null && _presenterConnection != connectionId) return Fail("presentationActive");
                    if (command.Kind == "delete") slides.RemoveAll(slide => slide.Id == command.SlideId);
                    else {
                        if (!ValidTitle(command.Title)) return Fail("invalidTitle");
                        slides = slides.Select(slide => slide.Id == command.SlideId ? slide with { Title = command.Title!.Trim() } : slide).ToList();
                    }
                } else if (command.Kind == "present") {
                    if (_presenterConnection is not null && _presenterConnection != connectionId) return Fail("presentationActive");
                    if (EffectiveSlide(connectionId) is null) return Fail("slideRequired");
                } else if (command.Kind == "stopPresentation") {
                    if (_presenterConnection != connectionId && user.Role != OnlineRoles.Admin) return Fail("forbidden");
                } else return Fail("invalidKind");
                var next = new WorkspaceDocument { Revision = _document.Revision + 1, Slides = slides };
                await _files.WriteAsync("workspace.json", next, CancellationToken.None);
                _document = next;
                if (command.Kind == "replace") {
                    foreach (var id in _connections.ConnectionIds.Where(id => _connections.LocalSlide(id) == command.SourceSlideId)) _connections.SelectSlide(id, command.SlideId!);
                    if (_presenterSlide == command.SourceSlideId) _presenterSlide = command.SlideId;
                }
                if (command.Kind == "present") { _presenterId = user.Id; _presenterSlide = EffectiveSlide(connectionId); _presenterConnection = connectionId; }
                if (command.Kind == "stopPresentation" || Find(_presenterSlide ?? "") is null) StopPresentation();
                _operations[command.OperationId] = (user.Id, command);
                if (_operations.Count > 256) _operations.Remove(_operations.Keys.First());
                await PublishAsync();
                return new(true, null, Get(connectionId));
            } finally { _gate.Release(); }
        } finally { _files.AccountGate.Release(); }
    }
    public async Task EndPresentationAsync(string? connectionId = null, string? userId = null)
    {
        await _gate.WaitAsync();
        try {
            if (_presenterConnection is null || (connectionId != _presenterConnection && userId != _presenterId)) return;
            StopPresentation();
            _document = new() { Revision = _document.Revision + 1, Slides = _document.Slides };
            await PublishAsync();
        } finally { _gate.Release(); }
    }
    private async Task PublishAsync()
    {
        _connections.PresenterConnectionId = _presenterConnection;
        foreach (var id in _connections.ConnectionIds) await JoinAsync(id);
        await _hub.Clients.All.SendAsync("WorkspaceChanged", Get());
        await _hub.Clients.All.SendAsync("UsersChanged", _connections.List());
    }
    private void StopPresentation()
    {
        if (_presenterSlide is not null && Find(_presenterSlide) is not null)
            foreach (var id in _connections.ConnectionIds) _connections.SelectSlide(id, _presenterSlide);
        _presenterId = _presenterConnection = _presenterSlide = null;
    }
    private static bool ValidId(string? id) => id is { Length: > 0 and <= 128 } && Regex.IsMatch(id, "^[a-zA-Z0-9_-]+$");
    private static bool ValidTitle(string? title) => !string.IsNullOrWhiteSpace(title) && title.Length <= 80 && !title.Any(char.IsControl);
}
