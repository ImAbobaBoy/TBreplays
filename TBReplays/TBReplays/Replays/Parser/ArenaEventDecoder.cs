namespace TBReplays.Replays.Parser;

public sealed record ArenaEvents(IReadOnlyList<ReplayScoreEvent> Scores,
    IReadOnlyList<ReplayKillEvent> Kills, int? WinnerTeamId, int? FinishReason, float? EndTime);

public static class ArenaEventDecoder
{
    public static ArenaEvents Decode(IReadOnlyList<ReplayPacket> packets, IReadOnlySet<uint> vehicleIds)
    {
        var scores = new List<ReplayScoreEvent>();
        var kills = new List<ReplayKillEvent>();
        var lastPoints = new Dictionary<int, int>();
        var winner = (int?)null;
        var reason = (int?)null;
        var endTime = (float?)null;
        foreach (var packet in packets)
        {
            var method = EntityMethodPacketDecoder.TryDecode(packet);
            if (method is null || vehicleIds.Contains(method.EntityId)) continue;
            var p = method.MethodPayload;
            if (method.MethodId == 6 && p.Length == 3 && p[0] <= 2)
            {
                winner = p[0]; reason = p[1]; endTime = packet.ClockSeconds;
            }
            if (method.MethodId != 55 || p.Length < 2 || p[0] is not (6 or 13)) continue;
            // BigWorld packed string length: one byte, or 0xff followed by a 24-bit length.
            var header = p[1] == 255 ? 5 : 2;
            if (p.Length < header) continue;
            var length = header == 2 ? p[1] : p[2] | (p[3] << 8) | (p[4] << 16);
            if (length != p.Length - header) continue;
            try
            {
                var outer = ProtoReader.ReadFields(p[header..]);
                var nested = outer.FirstOrDefault(x => x.FieldNumber == (p[0] == 13 ? 12 : 6)
                    && x.WireType == ProtoWireType.LengthDelimited);
                if (nested is null) continue;
                var fields = ProtoReader.ReadFields(nested.BytesValue);
                if (p[0] == 13)
                {
                    var team = ReadInt(fields, 3);
                    var points = ReadInt(fields, 2) ?? 0;
                    if (team is not (1 or 2) || points < 0) continue;
                    var delta = lastPoints.TryGetValue(team.Value, out var old) ? points - old : (int?)null;
                    scores.Add(new ReplayScoreEvent(packet.ClockSeconds, packet.Index, team.Value, points, delta));
                    lastPoints[team.Value] = points;
                }
                else
                {
                    var victim = ReadInt(fields, 1);
                    var killer = ReadInt(fields, 2);
                    if (victim is null || !vehicleIds.Contains((uint)victim)) continue;
                    kills.Add(new ReplayKillEvent(packet.ClockSeconds, packet.Index, (uint)victim,
                        killer is > 0 && vehicleIds.Contains((uint)killer) ? (uint)killer : null));
                }
            }
            catch (Exception e) when (e is IOException or OverflowException) { /* Unknown event profile. */ }
        }
        return new ArenaEvents(scores, kills.DistinctBy(x => x.VictimEntityId).ToArray(), winner, reason, endTime);
    }

    internal static int? ReadInt(IReadOnlyList<ProtoField> fields, int number)
    {
        var value = fields.FirstOrDefault(x => x.FieldNumber == number && x.WireType == ProtoWireType.Varint)?.VarintValue;
        return value is <= int.MaxValue ? (int)value.Value : null;
    }
}
