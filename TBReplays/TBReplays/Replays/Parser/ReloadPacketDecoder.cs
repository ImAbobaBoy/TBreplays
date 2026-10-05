using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public static class ReloadPacketDecoder
{
    // These layouts were validated on 26.10 recordings. Unknown versions fail closed.
    public static IReadOnlyList<ReplayReloadEvent> Decode(ReplayPacket packet, string version)
    {
        if (!version.StartsWith("26.10.", StringComparison.Ordinal)) return [];
        var method = EntityMethodPacketDecoder.TryDecode(packet);
        if (method is null) return [];
        var p = method.MethodPayload;
        ReplayReloadEvent Frame(uint entity, float seconds, string kind, int? code = null) => new(
            packet.ClockSeconds, packet.Index, packet.Offset, entity, seconds, kind,
            method.MethodId, code, Convert.ToHexString(p));
        static bool Valid(float seconds) => float.IsFinite(seconds) && seconds >= 0 && seconds <= 3600;
        if (method.MethodId == 41 && p.Length == 13)
        {
            var seconds = BinaryPrimitives.ReadSingleLittleEndian(p.AsSpan(4));
            return Valid(seconds) && seconds > 0 ? [Frame(BinaryPrimitives.ReadUInt32LittleEndian(p), seconds, "InitialHint")] : [];
        }
        if (method.MethodId == 15 && p.Length == 9)
        {
            var seconds = BinaryPrimitives.ReadSingleLittleEndian(p.AsSpan(5));
            var kind = p[4] switch { 0 or 3 => "Period", 4 => "Remaining", _ => "Unknown" };
            return Valid(seconds) ? [Frame(BinaryPrimitives.ReadUInt32LittleEndian(p), seconds, kind, p[4])] : [];
        }
        if (method.MethodId != 55 || p.Length < 2 || p[0] != 17) return [];
        var header = p[1] == 255 ? 5 : 2;
        if (p.Length < header) return [];
        var length = header == 2 ? p[1] : p[2] | (p[3] << 8) | (p[4] << 16);
        if (length != p.Length - header) return [];
        try
        {
            var outer = ProtoReader.ReadFields(p[header..]);
            var body = outer.SingleOrDefault(x => x.FieldNumber == 16 && x.WireType == ProtoWireType.LengthDelimited);
            if (body is null) return [];
            var frames = new List<ReplayReloadEvent>();
            foreach (var entry in ProtoReader.ReadFields(body.BytesValue).Where(x => x.FieldNumber == 1 && x.WireType == ProtoWireType.LengthDelimited))
            {
                var fields = ProtoReader.ReadFields(entry.BytesValue);
                var entity = fields.SingleOrDefault(x => x.FieldNumber == 1 && x.WireType == ProtoWireType.Varint)?.VarintValue;
                var value = fields.SingleOrDefault(x => x.FieldNumber == 3 && x.WireType == ProtoWireType.Fixed32)?.BytesValue;
                if (entity is not (> 0 and <= uint.MaxValue) || value?.Length != 4) continue;
                var seconds = BinaryPrimitives.ReadSingleLittleEndian(value);
                if (Valid(seconds) && seconds > 0) frames.Add(Frame((uint)entity.Value, seconds, "Period"));
            }
            return frames;
        }
        catch (Exception e) when (e is IOException or OverflowException or InvalidOperationException) { return []; }
    }
}
