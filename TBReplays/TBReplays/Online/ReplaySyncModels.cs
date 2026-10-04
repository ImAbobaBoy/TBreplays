namespace TBReplays.Online;

public sealed record ReplaySyncState(string ServerId, long Sequence, long Revision, string SessionId,
    string? ReplayId, string? MapId, string? LeaderId, string? LeaderConnectionId,
    double Time, double MinTime, double MaxTime, double Speed, bool IsPlaying,
    long UpdatedAtUnixMs, long ServerNowUnixMs, string Reason, string? SlideId = null);
public sealed record ReplaySyncCommand(string OperationId, string Kind, string SessionId,
    long ExpectedRevision, string? ReplayId = null, double? Time = null, double? Speed = null, string? SlideId = null);
public sealed record ReplayTiming(string SessionId, long Revision, double Time, bool IsPlaying, double Speed, long SampledAtUnixMs, string? SlideId = null);
public sealed record ReplaySyncResult(bool Applied, string? Error, ReplaySyncState State);
public sealed record ReplaySyncInfo(double MinTime, double MaxTime, string? MapName, string? BackendMapId);
