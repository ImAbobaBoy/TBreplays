using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

[Authorize]
public sealed class SketchHub(SketchService sketches, OnlineSecurity security,
    OnlineConnections connections, OnlineFiles files) : Hub
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
        return result;
    }

    private async Task RequireSession()
    {
        if (await security.GetCurrentAsync(Context.User, Context.ConnectionAborted) is not null) return;
        Context.Abort();
        throw new HubException("unauthorized");
    }
}
