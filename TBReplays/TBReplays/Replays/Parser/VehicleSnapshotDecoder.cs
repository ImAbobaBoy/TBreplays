using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public sealed record VehicleSnapshot(
    int PacketIndex, float Time, uint EntityId, int Health, int MaxHealth,
    IReadOnlyList<ExtraEffectStateFrame> Extras);

/// <summary>Validated entity-creation layout for the supplied 26.x replays.
/// Unknown layouts fail closed; HP from results remains available.</summary>
public static class VehicleSnapshotDecoder
{
    public static VehicleSnapshot? TryDecode(ReplayPacket packet) => TryDecode(packet, 2);

    public static VehicleSnapshot? TryDecode(ReplayPacket packet, int idWidth)
    {
        if (idWidth is not (1 or 2)) return null;
        var entrySize = 13 + idWidth;
        var p = packet.Payload;
        if (packet.Type != 5 || p.Length < 100 || BinaryPrimitives.ReadUInt16LittleEndian(p.AsSpan(4)) != 2
            || BinaryPrimitives.ReadInt32LittleEndian(p.AsSpan(38)) != p.Length - 42
            || p[42] != 19 || p[43] != 0 || p[45] != 1 || p[47] != 2 || p[50] != 3
            || p[53] != 4 || p[56] != 5 || p[61] != 6)
            return null;

        var result = (VehicleSnapshot?)null;
        // Properties 7..10 are variable-length. Locate a uniquely valid typed suffix 11..18,
        // validating all entries, lengths, property IDs and exact end of the entity block.
        for (var offset = 62; offset + 2 < p.Length; offset++)
        {
            if (p[offset] != 11) continue;
            var count = p[offset + 1];
            var tail = offset + 2 + count * entrySize;
            if (count > 64 || tail >= p.Length || !TryReadTail(p, tail, out var maxHealth)) continue;
            var extras = new List<ExtraEffectStateFrame>();
            for (var i = 0; i < count; i++)
            {
                var extra = ExtraEffectPacketDecoder.ReadEntry(packet, offset + 2 + i * entrySize, true, idWidth);
                if (extra is null) break;
                extras.Add(extra);
            }
            if (extras.Count != count || extras.Select(x => x.ExtraId).Distinct().Count() != count) continue;
            var health = BinaryPrimitives.ReadInt16LittleEndian(p.AsSpan(51));
            if (maxHealth <= 0 || maxHealth > short.MaxValue || health > maxHealth) continue;
            if (result is not null) return null; // Ambiguous data must never silently choose an HP.
            result = new VehicleSnapshot(packet.Index, packet.ClockSeconds,
                BinaryPrimitives.ReadUInt32LittleEndian(p), Math.Max(0, (int)health), maxHealth, extras);
        }
        return result;
    }

    private static bool TryReadTail(byte[] p, int offset, out int maxHealth)
    {
        maxHealth = 0;
        if (!SkipString(p, ref offset, 12) || !SkipString(p, ref offset, 13)) return false;
        if (offset + 3 > p.Length || p[offset++] != 14) return false;
        maxHealth = BinaryPrimitives.ReadUInt16LittleEndian(p.AsSpan(offset));
        offset += 2;
        if (offset + 3 > p.Length || p[offset++] != 15) return false;
        offset += 2;
        if (offset + 9 > p.Length || p[offset++] != 16) return false;
        offset += 8;
        if (offset + 2 > p.Length || p[offset++] != 17) return false;
        var count = p[offset++];
        offset += count * 4;
        return SkipString(p, ref offset, 18) && offset == p.Length;
    }

    private static bool SkipString(byte[] p, ref int offset, byte property)
    {
        if (offset + 2 > p.Length || p[offset++] != property) return false;
        var length = (int)p[offset++];
        if (length == 255) return false; // Extended lengths are not part of the validated profile.
        if (length > p.Length - offset) return false;
        offset += length;
        return true;
    }
}
