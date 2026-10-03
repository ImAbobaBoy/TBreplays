using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

[Authorize]
public sealed class SketchHub(SketchService sketches, OnlineSecurity security,
    OnlineConnections connections, OnlineFiles files, ReplaySyncService replays) : Hub
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
        await Clients.Caller.SendAsync("SketchSnapshot", await sketches.GetAsync(Context.ConnectionAborted));
        await Clients.All.SendAsync("UsersChanged", connections.List());
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        connections.Remove(Context.ConnectionId);
        await replays.DisconnectedAsync(Context.ConnectionId);
        await Clients.All.SendAsync("UsersChanged", connections.List());
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<SketchState> GetState()
    {
        await RequireSession();
        return await sketches.GetAsync(Context.ConnectionAborted);
    }

    public async Task<IReadOnlyList<UserDto>> GetUsers()
    {
        await RequireSession();
        return connections.List();
    }

    public async Task<SketchResult> Apply(SketchCommand command)
    {
        var result = await sketches.ApplyAsync(Context.User!, command, Context.ConnectionAborted);
        if (result.Error == "unauthorized") Context.Abort();
        if (result.Applied && result.Change?.Kind == "setMap") await replays.MapChangedAsync();
        return result;
    }

    public async Task<ReplaySyncState> GetReplay()
    {
        var user = await RequireSession();
        return await replays.GetAsync(user.Id, Context.ConnectionId,
            user.Role is OnlineRoles.Admin or OnlineRoles.Editor);
    }
    public async Task<ReplaySyncResult> ReplayApply(ReplaySyncCommand command)
    {
        var result = await replays.ApplyAsync(Context.User!, Context.ConnectionId, command);
        if (result.Error == "unauthorized") Context.Abort();
        return result;
    }
    public async Task<ReplaySyncResult> ReplayHeartbeat(ReplayTiming timing)
    {
        var result = await replays.TimingAsync(Context.User!, Context.ConnectionId, timing);
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
