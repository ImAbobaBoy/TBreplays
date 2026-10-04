using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

[Authorize]
public sealed class SketchHub(SketchService sketches, OnlineSecurity security,
    OnlineConnections connections, OnlineFiles files, ReplaySyncService replays, WorkspaceService workspace) : Hub
{
    public override async Task OnConnectedAsync()
    {
        await files.AccountGate.WaitAsync(Context.ConnectionAborted);
        try
        {
            var user = await security.GetCurrentAsync(Context.User, Context.ConnectionAborted);
            if (user is null) { Context.Abort(); return; }
            connections.Add(UserDto.From(user), Context);
        }
        finally { files.AccountGate.Release(); }
        await workspace.JoinAsync(Context.ConnectionId);
        await Clients.Caller.SendAsync("WorkspaceSnapshot", workspace.Get(Context.ConnectionId));
        await Clients.Caller.SendAsync("SketchSnapshot", await GetState());
        await Clients.All.SendAsync("UsersChanged", connections.List());
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        connections.Remove(Context.ConnectionId);
        await workspace.EndPresentationAsync(connectionId: Context.ConnectionId);
        await replays.DisconnectedAsync(Context.ConnectionId);
        await Clients.All.SendAsync("UsersChanged", connections.List());
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<SketchState> GetState()
    {
        var user = await RequireSession();
        var slide = workspace.EffectiveSlide(Context.ConnectionId);
        return slide is null ? new SketchState(0, null, 0, [], []) : await sketches.GetSlideAsync(slide, user.Id, Context.ConnectionAborted);
    }
    public async Task<WorkspaceState> GetWorkspace() { await RequireSession(); return workspace.Get(Context.ConnectionId); }
    public async Task<WorkspaceResult> WorkspaceApply(WorkspaceCommand command) => await workspace.ApplyAsync(Context.User!, Context.ConnectionId, command);
    public async Task<WorkspaceResult> SelectSlide(string slideId) { await RequireSession(); return await workspace.SelectAsync(Context.ConnectionId, slideId); }

    public async Task<IReadOnlyList<UserDto>> GetUsers()
    {
        await RequireSession();
        return connections.List();
    }

    public async Task<SketchResult> Apply(SketchCommand command)
    {
        var result = await sketches.ApplyAsync(Context.User!, command with { ConnectionId = Context.ConnectionId }, Context.ConnectionAborted);
        if (result.Error == "unauthorized") Context.Abort();
        if (result.Applied && result.Change?.Kind == "setMap") await replays.MapChangedAsync();
        return result;
    }

    public async Task<ReplaySyncState> GetReplay()
    {
        var user = await RequireSession();
        return await replays.GetAsync(user.Id, Context.ConnectionId,
            user.Role is OnlineRoles.Admin or OnlineRoles.Editor, workspace.EffectiveSlide(Context.ConnectionId));
    }
    public async Task<ReplaySyncResult> ReplayApply(ReplaySyncCommand command)
    {
        var result = await replays.ApplyAsync(Context.User!, Context.ConnectionId, command with { SlideId = workspace.EffectiveSlide(Context.ConnectionId) });
        if (result.Error == "unauthorized") Context.Abort();
        return result;
    }
    public async Task<ReplaySyncResult> ReplayHeartbeat(ReplayTiming timing)
    {
        var result = await replays.TimingAsync(Context.User!, Context.ConnectionId, timing with { SlideId = workspace.EffectiveSlide(Context.ConnectionId) });
        if (result.Error == "unauthorized") Context.Abort();
        return result;
    }
    private async Task<OnlineUser> RequireSession()
    {
        var user = await security.GetCurrentAsync(Context.User, Context.ConnectionAborted);
        if (user is not null) return user;
        Context.Abort();
        throw new HubException("unauthorized");
    }
}
