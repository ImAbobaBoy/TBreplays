namespace TBReplays.Replays;

public sealed record ReplayReloadEvent(float Time, int PacketIndex, int PacketOffset, uint EntityId,
    float Seconds, string Kind, uint MethodId, int? StateCode, string RawPayloadHex);

// Complete keyframes in replay time: progress = (time - startedAt)/(readyAt - startedAt).
// Null bounds mean loaded; a null duration means the reload is not observable.
public sealed record ReplayReloadFrame(float Time, float? DurationSeconds, float? StartedAt, float? ReadyAt);

public static class ReplayReloadTimeline
{
    public static IReadOnlyList<ReplayReloadFrame> Build(IEnumerable<ReplayReloadEvent> events, IEnumerable<ReplayShotEvent> shots)
    {
        var updates = events.Where(x => x.Kind != "Unknown")
            .Select(x => (x.Time, x.PacketIndex, Event: x, Shot: (ReplayShotEvent?)null))
            .Concat(shots.Select(x => (x.Time, x.PacketIndex, Event: (ReplayReloadEvent)null!, Shot: (ReplayShotEvent?)x)))
            // A shot and its recalculated remaining time can share a timestamp.
            // Apply period -> shot -> countdown, even if their packets arrived out of order.
            .OrderBy(x => x.Time)
            .ThenBy(x => x.Shot is not null ? 2 : x.Event.Kind == "Remaining" ? 3 : x.Event.Kind == "Period" ? 1 : 0)
            .ThenBy(x => x.PacketIndex).ToArray();
        var frames = new List<ReplayReloadFrame>();
        float? period = null, started = null, ready = null;
        foreach (var update in updates)
        {
            var time = update.Time;
            if (update.Shot is not null)
            {
                started = time;
                ready = period is > 0 ? time + period : null;
            }
            else
            {
                var e = update.Event;
                if (e.Kind == "Period" || e.Kind == "InitialHint" && period is null)
                {
                    if (e.Seconds > 0) period = e.Seconds;
                    // A period arriving at the firing timestamp also applies to that shot,
                    // regardless of network order; later period changes affect the next shot.
                    if (started == time && period is > 0) ready = time + period;
                }
                else if (e.Kind == "Remaining")
                {
                    // A direct countdown correction can shorten or extend an active reload.
                    // Keep its firing time; no wall clock or animation state survives seeking.
                    if (started is null || ready is not null && ready < time)
                        started = time;
                    ready = time + e.Seconds;
                    period ??= e.Seconds > 0 ? e.Seconds : null;
                }
            }
            var frame = new ReplayReloadFrame(time, period, started, ready);
            if (frames.Count > 0 && frames[^1].Time == time) frames[^1] = frame;
            else frames.Add(frame);
        }
        return frames;
    }
}
