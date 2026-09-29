using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

public sealed class OnlineConnections
{
    private readonly ConcurrentDictionary<string, (UserDto User, HubCallerContext Context)> _connections = new();
    public void Add(UserDto user, HubCallerContext context) => _connections[context.ConnectionId] = (user, context);
    public void Remove(string id) => _connections.TryRemove(id, out _);
    public IReadOnlyList<UserDto> List() => _connections.Values.Select(x => x.User)
        .DistinctBy(x => x.Id).OrderBy(x => x.Login).ToArray();
    public void Revoke(string userId)
    {
        foreach (var item in _connections.Where(x => x.Value.User.Id == userId))
        {
            _connections.TryRemove(item.Key, out _);
            item.Value.Context.Abort();
        }
    }
}
