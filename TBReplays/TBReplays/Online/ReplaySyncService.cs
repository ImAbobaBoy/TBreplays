using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using TBReplays.Replays;

namespace TBReplays.Online;

// Only commands and clock anchors live here; no per-frame tank state and no periodic disk writes.
public sealed class ReplaySyncService(OnlineFiles files, OnlineSecurity security, SketchService sketches,
    IReplaySyncCatalog catalog, IHubContext<SketchHub> hub, ILogger<ReplaySyncService> logger) : BackgroundService
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private ReplaySyncState _state = new(Guid.NewGuid().ToString("N"), 0, 0, Guid.NewGuid().ToString("N"),
        null, null, null, null, 0, 0, 0, 1, false, Now(), Now(), "empty");
    private readonly Dictionary<string, (string User, ReplaySyncCommand Command)> _operations = [];
    private long _lastTimingAt;
    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private ReplaySyncState Snapshot() => _state with { ServerNowUnixMs = Now() };
    private double CurrentTime(long now) => Math.Clamp(_state.Time + (_state.IsPlaying
        ? Math.Max(0, now - _state.UpdatedAtUnixMs) / 1000d * _state.Speed : 0), _state.MinTime, _state.MaxTime);

    public async Task<ReplaySyncState> GetAsync(string userId, string connectionId, bool canLead)
    {
        await _gate.WaitAsync();
        try
        {
            if (canLead && _state.ReplayId is not null && _state.LeaderId == userId && _state.LeaderConnectionId is null)
            {
                _state = _state with { LeaderConnectionId = connectionId, Sequence = _state.Sequence + 1, Reason = "leaderReturned" };
                _lastTimingAt = Now();
                await Broadcast();
            }
            return Snapshot();
        }
        finally { _gate.Release(); }
    }
    public async Task<ReplaySyncResult> ApplyAsync(ClaimsPrincipal principal, string connectionId, ReplaySyncCommand command)
    {
        await files.AccountGate.WaitAsync();
        try
        {
            var user = await security.GetCurrentAsync(principal);
            await _gate.WaitAsync();
            try
            {
                ReplaySyncResult Fail(string error) => new(false, error, Snapshot());
                if (user is null) return Fail("unauthorized");
                if (user.Role is not (OnlineRoles.Admin or OnlineRoles.Editor)) return Fail("forbidden");
                if (command is null || !Guid.TryParse(command.OperationId, out _) || command.ExpectedRevision < 0
                    || command.Kind is not ("load" or "play" or "pause" or "seek" or "speed" or "unload")) return Fail("invalidCommand");
                if (_operations.TryGetValue(command.OperationId, out var previous))
                    return previous.User == user.Id && previous.Command == command ? new(true, null, Snapshot()) : Fail("operationIdConflict");
                if (command.SessionId != _state.SessionId || command.ExpectedRevision != _state.Revision) return Fail("replayConflict");
                var board = await sketches.GetAsync();
                var now = Now();
                var time = CurrentTime(now);
                var next = _state;
                if (command.Kind == "load")
                {
                    if (string.IsNullOrWhiteSpace(command.ReplayId) || board.MapId is null) return Fail("mapRequired");
                    ReplaySyncInfo? info;
                    try { info = await catalog.ReadAsync(command.ReplayId, CancellationToken.None); }
                    catch (Exception error) when (error is IOException or System.Text.Json.JsonException or InvalidOperationException or KeyNotFoundException)
                    { return Fail("replayUnavailable"); }
                    if (info is null) return Fail("replayUnavailable");
                    if (!ReplayMapNameMatcher.IsMatch(info.BackendMapId, board.MapId)
                        && !ReplayMapNameMatcher.IsMatch(info.MapName, board.MapId)) return Fail("replayMapMismatch");
                    next = next with { ReplayId = command.ReplayId, MapId = board.MapId,
                        LeaderId = user.Id, LeaderConnectionId = connectionId, SessionId = Guid.NewGuid().ToString("N"),
                        Time = info.MinTime, MinTime = info.MinTime, MaxTime = info.MaxTime, Speed = 1, IsPlaying = false };
                    _lastTimingAt = now + 45000;
                }
                else
                {
                    if (next.ReplayId is null || next.MapId != board.MapId) return Fail("replayRequired");
                    if (command.Kind != "unload" && next.LeaderConnectionId is null) return Fail("leaderOffline");
                    next = next with { Time = time, IsPlaying = next.IsPlaying && time < next.MaxTime };
                    switch (command.Kind)
                    {
                        case "play": next = next with { Time = time >= next.MaxTime ? next.MinTime : time, IsPlaying = true }; break;
                        case "pause": next = next with { IsPlaying = false }; break;
                        case "seek":
                            if (command.Time is not { } seek || !double.IsFinite(seek)) return Fail("invalidTime");
                            next = next with { Time = Math.Clamp(seek, next.MinTime, next.MaxTime) }; break;
                        case "speed":
                            if (command.Speed is not { } speed || !double.IsFinite(speed) || speed < .25 || speed > 4) return Fail("invalidSpeed");
                            next = next with { Speed = speed }; break;
                        case "unload": next = Empty(next); break;
                    }
                }
                _state = next with { Revision = _state.Revision + 1, Sequence = _state.Sequence + 1, UpdatedAtUnixMs = now, Reason = command.Kind };
                _operations[command.OperationId] = (user.Id, command);
                if (_operations.Count > 128) _operations.Remove(_operations.Keys.First());
                await Broadcast();
                return new(true, null, Snapshot());
            }
            finally { _gate.Release(); }
        }
        finally { files.AccountGate.Release(); }
    }
    public async Task<ReplaySyncResult> TimingAsync(ClaimsPrincipal principal, string connectionId, ReplayTiming timing)
    {
        await files.AccountGate.WaitAsync();
        try
        {
            var user = await security.GetCurrentAsync(principal);
            await _gate.WaitAsync();
            try
            {
                ReplaySyncResult Fail(string error) => new(false, error, Snapshot());
                if (user is null) return Fail("unauthorized");
                if (user.Role is not (OnlineRoles.Admin or OnlineRoles.Editor) || user.Id != _state.LeaderId
                    || connectionId != _state.LeaderConnectionId) return Fail("notLeader");
                if (timing is null || timing.SessionId != _state.SessionId || timing.Revision != _state.Revision) return Fail("replayConflict");
                var now = Now();
                if (!double.IsFinite(timing.Time) || timing.Time < _state.MinTime || timing.Time > _state.MaxTime
                    || timing.Speed != _state.Speed || Math.Abs((double)now - timing.SampledAtUnixMs) > 10000
                    || timing.IsPlaying != _state.IsPlaying && !(timing.Time >= _state.MaxTime && !timing.IsPlaying)) return Fail("invalidTiming");
                // One tab is authoritative. Commands increment Revision, heartbeats only Sequence.
                var playing = timing.IsPlaying && timing.Time < _state.MaxTime;
                var time = Math.Clamp(timing.Time + (playing ? Math.Max(0, now - timing.SampledAtUnixMs) / 1000d * timing.Speed : 0), _state.MinTime, _state.MaxTime);
                _state = _state with { Time = time, IsPlaying = playing && time < _state.MaxTime,
                    Sequence = _state.Sequence + 1, UpdatedAtUnixMs = now, Reason = "timing" };
                _lastTimingAt = now;
                await Broadcast();
                return new(true, null, Snapshot());
            }
            finally { _gate.Release(); }
        }
        finally { files.AccountGate.Release(); }
    }
    public async Task DisconnectedAsync(string connectionId)
    {
        await _gate.WaitAsync();
        try { if (_state.LeaderConnectionId == connectionId) await PauseLeader("leaderOffline"); }
        finally { _gate.Release(); }
    }
    public async Task MapChangedAsync()
    {
        await _gate.WaitAsync();
        try
        {
            // Read the current board: delayed or duplicate setMap acknowledgements may refer to an older map.
            var board = await sketches.GetAsync();
            if (_state.ReplayId is null || _state.MapId == board.MapId) return;
            _state = Empty(_state) with { Revision = _state.Revision + 1, Sequence = _state.Sequence + 1, UpdatedAtUnixMs = Now(), Reason = "mapChanged" };
            await Broadcast();
        }
        finally { _gate.Release(); }
    }
    private static ReplaySyncState Empty(ReplaySyncState state) => state with { ReplayId = null, MapId = null,
        LeaderId = null, LeaderConnectionId = null, SessionId = Guid.NewGuid().ToString("N"), Time = 0, MinTime = 0, MaxTime = 0, Speed = 1, IsPlaying = false };
    private async Task PauseLeader(string reason)
    {
        var now = Now();
        _state = _state with { Time = CurrentTime(now), IsPlaying = false, LeaderConnectionId = null,
            Revision = _state.Revision + 1, Sequence = _state.Sequence + 1, UpdatedAtUnixMs = now, Reason = reason };
        await Broadcast();
    }
    private async Task Broadcast()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        try { await hub.Clients.All.SendAsync("ReplayChanged", Snapshot(), timeout.Token); }
        catch (Exception error) { logger.LogWarning(error, "Replay broadcast failed at {Sequence}", _state.Sequence); }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await _gate.WaitAsync(stoppingToken);
                try { if (_state.LeaderConnectionId is not null && Now() - _lastTimingAt > 15000) await PauseLeader("leaderTimeout"); }
                finally { _gate.Release(); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}
