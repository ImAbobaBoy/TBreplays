using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

// Transient presence is never persisted alongside maps or undo history.
public sealed class ScenePresenceService(OnlineFiles files, OnlineSecurity security, OnlineConnections connections,
    WorkspaceService workspace, IHubContext<SketchHub> hub)
{
    private readonly ConcurrentDictionary<string, ScenePresenceFrame> _frames = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, string> _colors = [];
    private static readonly string[] Palette = ["#ffcc33", "#38bdf8", "#f472b6", "#4ade80", "#c084fc", "#fb923c", "#2dd4bf", "#f87171"];

    public ScenePresenceFrame[] Get(string connectionId)
    {
        var slide = workspace.EffectiveSlide(connectionId);
        var editors = connections.List().Where(user => user.Role is OnlineRoles.Admin or OnlineRoles.Editor).Select(user => user.Id).ToHashSet();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return _frames.Values.Where(frame => frame.ConnectionId != connectionId && frame.SlideId == slide
            && editors.Contains(frame.UserId) && connections.JoinedSlide(frame.ConnectionId) == slide)
            .Select(frame => frame with {
                Cursor = now - frame.UpdatedAtUnixMs < 10000 ? frame.Cursor : null,
                Camera = workspace.Get().PresenterConnectionId == frame.ConnectionId ? frame.Camera : null
            }).ToArray();
    }

    public async Task<bool> UpdateAsync(ClaimsPrincipal principal, string connectionId, ScenePresenceCommand command, CancellationToken ct)
    {
        await files.AccountGate.WaitAsync(ct);
        try {
            var user = await security.GetCurrentAsync(principal, ct);
            if (user is null || connections.UserIdFor(connectionId) != user.Id) throw new HubException("unauthorized");
            if (user.Role is not (OnlineRoles.Admin or OnlineRoles.Editor)) throw new HubException("forbidden");
            if (command is null || command.Sequence <= 0 || !workspace.CanAccess(user.Id, connectionId, command.SlideId)) throw new HubException("slideConflict");
            if (!ValidPoint(command.Cursor) || command.Camera is not null && !ValidCamera(command.Camera)) throw new HubException("invalidPresence");
            if (command.Camera is not null && workspace.Get().PresenterConnectionId != connectionId) throw new HubException("notPresenter");
            await _gate.WaitAsync(ct);
            try {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (_frames.TryGetValue(connectionId, out var previous)
                    && (command.Sequence <= previous.Sequence || now - previous.UpdatedAtUnixMs < 40)) return false;
                if (!_colors.TryGetValue(user.Id, out var color)) {
                    color = Palette.OrderBy(candidate => _colors.Values.Count(value => value == candidate)).First();
                    _colors[user.Id] = color;
                }
                var frame = new ScenePresenceFrame(connectionId, user.Id, user.UserName!, color, command.SlideId,
                    command.Sequence, now, command.Cursor, command.Camera);
                _frames[connectionId] = frame;
                await hub.Clients.GroupExcept(WorkspaceService.Group(command.SlideId), [connectionId]).SendAsync("ScenePresenceChanged", frame, ct);
                return true;
            } finally { _gate.Release(); }
        } finally { files.AccountGate.Release(); }
    }

    public async Task RemoveAsync(string connectionId)
    {
        await _gate.WaitAsync();
        try {
            if (_frames.TryRemove(connectionId, out var frame))
                await hub.Clients.Group(WorkspaceService.Group(frame.SlideId)).SendAsync("ScenePresenceRemoved", connectionId);
        } finally { _gate.Release(); }
    }

    private static bool ValidPoint(SketchPoint? point) => point is null ||
        double.IsFinite(point.X) && double.IsFinite(point.Y) && double.IsFinite(point.Z)
        && Math.Abs(point.X) <= 100000 && Math.Abs(point.Y) <= 100000 && Math.Abs(point.Z) <= 100000;
    private static bool ValidCamera(SceneCamera camera)
    {
        if (camera.Position is null || camera.Target is null || camera.Quaternion is null
            || !ValidPoint(camera.Position) || !ValidPoint(camera.Target) || !double.IsFinite(camera.Fov) || camera.Fov is < 10 or > 120) return false;
        var q = camera.Quaternion;
        var norm = q.X * q.X + q.Y * q.Y + q.Z * q.Z + q.W * q.W;
        return double.IsFinite(norm) && Math.Abs(norm - 1) < .01;
    }
}
