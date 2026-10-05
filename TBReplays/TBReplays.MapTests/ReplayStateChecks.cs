using System.Buffers.Binary;
using TBReplays.ClientGameData;
using TBReplays.Replays;
using TBReplays.Replays.Parser;

internal static class ReplayStateChecks
{
    public static void Run(string[] paths)
    {
        static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
        EntityMethodFrame Method(uint id, byte[] p) => new(12, 100, 2, 999, id, p);
        foreach (var width in new[] { 1, 2 })
        {
            var p = new byte[9 + width];
            BinaryPrimitives.WriteUInt32LittleEndian(p, 100);
            p[4] = 4; p[5] = 35;
            BinaryPrimitives.WriteUInt32LittleEndian(p.AsSpan(5 + width), 12345);
            var frame = ModulePacketDecoder.TryDecodeModuleState(Method(20, p), width);
            Check(frame?.EntityId == 100 && frame.ModuleId == 35 && frame.SourceEntityId == 12345, "Module source alignment lost");
            Check(ModulePacketDecoder.TryDecodeModuleState(Method(20, p[..^1]), width) is null, "Truncated module accepted");
            var hit = new byte[9 + 2 * (width + 2)];
            hit[8] = 2; hit[9] = 35; hit[9 + width] = 2;
            hit[9 + width + 2] = 43; hit[9 + 2 * width + 2] = 1;
            var hits = ModulePacketDecoder.DecodeModuleHitSummary(Method(45, hit), width);
            Check(hits.Count == 2 && hits[0].ModuleId == 35 && hits[0].StateCode == 2 && hits[1].ModuleId == 43 && hits[1].StateCode == 1, "Module stride lost");
            Check(ModulePacketDecoder.DecodeModuleHitSummary(Method(45, hit[..^1]), width).Count == 0, "Partial summary accepted");
        }
        ReplayPacket Packet(uint method, byte[] value)
        {
            var p = new byte[12 + value.Length];
            BinaryPrimitives.WriteUInt32LittleEndian(p, 999);
            BinaryPrimitives.WriteUInt32LittleEndian(p.AsSpan(4), method);
            BinaryPrimitives.WriteInt32LittleEndian(p.AsSpan(8), value.Length);
            value.CopyTo(p, 12);
            return new(1, 100, p.Length, 8, 2, p);
        }
        var timer = new byte[9]; timer[0] = 100; timer[4] = 4;
        BinaryPrimitives.WriteSingleLittleEndian(timer.AsSpan(5), 8);
        Check(ReloadPacketDecoder.Decode(Packet(15, timer), "26.10.0_ruby").Single().Kind == "Remaining", "Remaining timer missing");
        Check(ReloadPacketDecoder.Decode(Packet(15, timer), "26.4.0_ruby").Count == 0, "Unvalidated reload version accepted");
        foreach (var value in new[] { float.NaN, float.PositiveInfinity, -1f, 10000f })
        {
            BinaryPrimitives.WriteSingleLittleEndian(timer.AsSpan(5), value);
            Check(ReloadPacketDecoder.Decode(Packet(15, timer), "26.10.0_ruby").Count == 0, "Invalid reload value accepted");
        }
        ReplayReloadEvent Reload(float t, int index, float seconds, string kind) => new(t, index, 0, 100, seconds, kind, 15, null, "");
        ReplayShotEvent Shot(float t, int index) => new() { Time = t, PacketIndex = index, ShooterEntityId = 100 };
        var events = new[] { Reload(0, 0, 10, "Period"), Reload(24, 3, 12, "Remaining"), Reload(26, 4, 2, "Remaining"), Reload(27, 5, 99, "Unknown") };
        var timeline = ReplayReloadTimeline.Build(events, [Shot(20, 2)]);
        Check(timeline[1].StartedAt == 20 && timeline[1].ReadyAt == 30, "Shot did not empty reload");
        Check(timeline[2].ReadyAt == 36 && timeline[3].ReadyAt == 28 && timeline.Count == 4, "Damage/repair countdown correction lost");
        var ordered = ReplayReloadTimeline.Build([Reload(20, 2, 5, "Period")], [Shot(20, 1)]);
        Check(ordered.Single().ReadyAt == 25, "Same-time firing packet order changes reload");
        var corrected = ReplayReloadTimeline.Build([Reload(0, 0, 10, "Period"), Reload(20, 1, 15, "Remaining")], [Shot(20, 2)]);
        Check(corrected.Last().ReadyAt == 35, "Shot overwrote same-time damage countdown");
        Check(ReplayReloadTimeline.Build([], [Shot(20, 1)]).Single().ReadyAt is null, "Missing duration invented");

        var catalog = new ClientGameDataCatalog { Version = "26.10.0_ruby", RootPath = "", Localization = new Dictionary<string,string>(),
            VehiclesByDescriptor = new Dictionary<int,VehicleDefinition>(), VehiclesByKey = new Dictionary<string,VehicleDefinition>(),
            ExtrasByKey = new Dictionary<string,ExtraDefinition>(), ExtrasByRuntimeId = new Dictionary<int,ExtraDefinition>(),
            ModulesByRuntimeId = new Dictionary<int,ModuleDefinition>(), Warnings = [] };
        foreach (var path in paths)
        {
            using var stream = File.OpenRead(path);
            var result = new ReplayParseService().Parse(stream, catalog);
            Check(result.ReloadEvents.Count > 0 && result.VehicleStateProtocolVersion == 1, "Real reload events missing");
            Check(result.ModuleCompactMarkers.Count == 0, "26.10 interpreted with legacy compact markers");
            Check(result.ReloadEvents.All(x => result.Vehicles.Any(v => v.EntityId == x.EntityId && v.TeamId == result.RecorderTeamId)), "Unobserved enemy reload fabricated");
            Check(result.Playback.Vehicles.Count(x => x.Reload.Any(f => f.DurationSeconds is > 0)) == result.ReloadEvents.Select(x => x.EntityId).Distinct().Count(), "Reload lost in presentation");
            if (path.Contains("2209"))
                Check(result.ModuleStateEvents.Any(x => x.ModuleId == 35 && x.SourceEntityId == 268917354)
                    && result.ModuleHitSummaryEvents.Any(x => x.ModuleId == 35 && x.StateCode == 2), "Real module fields misaligned");
            if (path.Contains("2317"))
            {
                Check(result.ModuleStateEvents.Any(x => x.ModuleId == 43 && x.StateCode == 10)
                    && result.ModuleStateEvents.Any(x => x.ModuleId == 43 && x.StateCode == 22), "Loader damage/repair missing");
                var ownTrack = result.Playback.Vehicles.Single(x => x.EntityId == result.RecorderEntityId);
                var damaged = ownTrack.Reload.Last(x => x.Time <= 193.5695f);
                var repaired = ownTrack.Reload.Last(x => x.Time <= 194.9483f);
                Check(damaged.StartedAt == 193.569412f && Math.Abs(damaged.ReadyAt!.Value - 207.885222f) < .001,
                    "Real loader damage countdown overwritten by firing packet");
                Check(repaired.StartedAt == damaged.StartedAt && Math.Abs(repaired.ReadyAt!.Value - 204.77022f) < .001,
                    "Real loader repair lost from reload timeline");
            }
            Console.WriteLine($"PASS: {Path.GetFileName(path)}: {result.ReloadEvents.Count} reload events, {result.ModuleStateEvents.Count} module states");
        }
        Console.WriteLine("PASS: versioned module decoding, timer validation, firing, damage/repair and same-time packet ordering");
    }
}
