using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

public sealed class OnlineConnections
{
    private readonly ConcurrentDictionary<string, (UserDto User, HubCallerContext Context)> _connections = new();
    private readonly ConcurrentDictionary<string, string> _localSlides = new();
    private readonly ConcurrentDictionary<string, string> _joinedSlides = new();
    public string? PresenterConnectionId { get; set; }
    public string[] ConnectionIds => _connections.Keys.ToArray();
    public string? UserIdFor(string id) => _connections.TryGetValue(id, out var connection) ? connection.User.Id : null;
    public string? LocalSlide(string id) => _localSlides.GetValueOrDefault(id);
    public void SelectSlide(string id, string slide) => _localSlides[id] = slide;
    public string? JoinedSlide(string id) => _joinedSlides.GetValueOrDefault(id);
    public void JoinSlide(string id, string? slide)
    {
        if (slide is null) _joinedSlides.TryRemove(id, out _);
        else _joinedSlides[id] = slide;
    }
    public void Add(UserDto user, HubCallerContext context) => _connections[context.ConnectionId] = (user, context);
    public void Remove(string id)
    {
        _connections.TryRemove(id, out _);
        _localSlides.TryRemove(id, out _);
        _joinedSlides.TryRemove(id, out _);
    }
    public void Update(UserDto user)
    {
        foreach (var item in _connections.Where(x => x.Value.User.Id == user.Id).ToArray())
            _connections[item.Key] = (user, item.Value.Context);
    }
    public IReadOnlyList<UserDto> List() => _connections.Values.Select(x => x.User with { IsPresenting = UserIdFor(PresenterConnectionId ?? "") == x.User.Id })
        .DistinctBy(x => x.Id).OrderBy(x => x.Login).ToArray();
    public void Revoke(string userId)
    {
        foreach (var item in _connections.Where(x => x.Value.User.Id == userId))
        {
            Remove(item.Key);
            item.Value.Context.Abort();
        }
    }
}
