using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public sealed record ExtraEffectStateFrame(
    int PacketIndex, int PacketOffset, float ClockSeconds, uint EntityId,
    byte Marker, int ExtraId, int StateCode,
    double TimerStamp = 0, float Duration = 0, bool IsSnapshot = false);

public static class ExtraEffectPacketDecoder
{
    public const uint PacketType = 32;

    public static ExtraEffectStateFrame? TryDecodeExtraState(ReplayPacket packet) => TryDecodeExtraState(packet, 2);

    public static ExtraEffectStateFrame? TryDecodeExtraState(ReplayPacket packet, int idWidth)
    {
        var p = packet.Payload;
        // Channel 32 also carries module updates (subtype 1). The path has 1 or 2 bytes.
        if (packet.Type != PacketType || (idWidth is not (1 or 2) || (p.Length != 23 + idWidth && p.Length != 24 + idWidth)) || p[4] != 0
            || BinaryPrimitives.ReadInt32LittleEndian(p.AsSpan(5)) != p.Length - 9
            || p[9] is not (0xac or 0xad))
            return null;

        return ReadEntry(packet, p.Length - 13 - idWidth, false, idWidth);
    }

    internal static ExtraEffectStateFrame? ReadEntry(ReplayPacket packet, int offset, bool snapshot, int idWidth = 2)
    {
        var p = packet.Payload.AsSpan(offset, 13 + idWidth);
        var id = idWidth == 1 ? p[0] : BinaryPrimitives.ReadUInt16LittleEndian(p);
        var state = p[idWidth];
        var stamp = BinaryPrimitives.ReadDoubleLittleEndian(p[(idWidth + 1)..]);
        var duration = BinaryPrimitives.ReadSingleLittleEndian(p[(idWidth + 9)..]);
        // Vehicle abilities use additional states (e.g. armorMovingLogic1 = 11).
        // Preserve them as Unknown rather than losing the entire vehicle snapshot.
        if (!double.IsFinite(stamp)
            || !float.IsFinite(duration) || stamp < 0 || duration < -1 || duration > 86400)
            return null;

        return new ExtraEffectStateFrame(packet.Index, packet.Offset, packet.ClockSeconds,
            BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload), snapshot ? (byte)0 : packet.Payload[9],
            id, state, stamp, duration, snapshot);
    }
}
