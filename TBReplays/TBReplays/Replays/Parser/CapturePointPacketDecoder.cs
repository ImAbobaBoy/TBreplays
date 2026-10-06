namespace TBReplays.Replays.Parser;

public static class CapturePointPacketDecoder
{
    // Validated against SC2 strategicpoint positions and score changes in 26.10.
    // Each message is a complete point state; omitted protobuf scalars are zero.
    public static IReadOnlyList<ReplayCapturePointEvent> Decode(IReadOnlyList<ReplayPacket> packets,
        IReadOnlySet<uint> vehicleIds, string version)
    {
        if (!version.StartsWith("26.10.", StringComparison.Ordinal)) return [];
        var frames = new List<ReplayCapturePointEvent>();
        foreach (var packet in packets)
        {
            var method = EntityMethodPacketDecoder.TryDecode(packet);
            if (method is null || vehicleIds.Contains(method.EntityId) || method.MethodId != 55) continue;
            var p = method.MethodPayload;
            if (p.Length < 2 || p[0] != 12) continue;
            var header = p[1] == 255 ? 5 : 2;
            if (p.Length < header) continue;
            var length = header == 2 ? p[1] : p[2] | p[3] << 8 | p[4] << 16;
            if (length != p.Length - header) continue;
            try
            {
                var body = ProtoReader.ReadFields(p[header..]).SingleOrDefault(f =>
                    f.FieldNumber == 11 && f.WireType == ProtoWireType.LengthDelimited);
                if (body is null) continue;
                var fields = ProtoReader.ReadFields(body.BytesValue);
                int Read(int number) => ArenaEventDecoder.ReadInt(fields, number) ?? 0;
                var id = Read(1); var progress = Read(4); var owner = Read(7); var capturing = Read(8);
                if (id is < 0 or > 25 || progress is < 0 or > 100 || owner is < 0 or > 2 || capturing is < 0 or > 2)
                    continue;
                frames.Add(new(packet.ClockSeconds, packet.Index, id, owner, capturing, progress / 100f,
                    "arenaMethod55Type12", Convert.ToHexString(p)));
            }
            catch (Exception e) when (e is IOException or OverflowException or InvalidOperationException) { }
        }
        return frames.OrderBy(x => x.Time).ThenBy(x => x.PacketIndex).ToArray();
    }
}
