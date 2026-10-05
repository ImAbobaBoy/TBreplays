using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public sealed record ModuleStateCandidateFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    int StateCode,
    int ModuleId,
    uint? SourceEntityId);

public sealed record ModuleHitSummaryCandidateFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    int StateCode,
    int ModuleId);

public sealed record CompactModuleMarkerFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    int Marker,
    int ModuleId);

public static class ModulePacketDecoder
{
    public const uint ModuleChannel = 32;
    public const uint EntityMethodChannel = 8;
    public const uint ModuleStateMethodId = 20;
    public const uint ModuleHitSummaryMethodId = 45;

    public static ModuleStateCandidateFrame? TryDecodeModuleState(EntityMethodFrame method, int idWidth = 1)
    {
        if (idWidth is not (1 or 2) || method.MethodId != ModuleStateMethodId || method.MethodPayload.Length != 9 + idWidth)
        {
            return null;
        }

        var payload = method.MethodPayload;
        var sourceEntityId = BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(5 + idWidth, 4));

        return new ModuleStateCandidateFrame(
            method.PacketIndex,
            method.PacketOffset,
            method.ClockSeconds,
            BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(0, 4)),
            payload[4],
            idWidth == 2 ? BinaryPrimitives.ReadUInt16LittleEndian(payload.AsSpan(5, 2)) : payload[5],
            sourceEntityId == 0 ? null : sourceEntityId);
    }

    public static IReadOnlyList<ModuleHitSummaryCandidateFrame> DecodeModuleHitSummary(EntityMethodFrame method, int idWidth = 1)
    {
        if (idWidth is not (1 or 2) || method.MethodId != ModuleHitSummaryMethodId || method.MethodPayload.Length < 9)
        {
            return [];
        }

        var payload = method.MethodPayload;
        var entityId = BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(0, 4));
        var moduleCount = payload[8];
        var entrySize = idWidth + 2;
        if (payload.Length != 9 + moduleCount * entrySize) return [];
        if (moduleCount == 0)
        {
            return [];
        }

        var result = new List<ModuleHitSummaryCandidateFrame>();
        var offset = 9;

        for (var index = 0; index < moduleCount; index++)
        {
            result.Add(new ModuleHitSummaryCandidateFrame(
                method.PacketIndex,
                method.PacketOffset,
                method.ClockSeconds,
                entityId,
                idWidth == 2 ? BinaryPrimitives.ReadUInt16LittleEndian(payload.AsSpan(offset + idWidth, 2)) : payload[offset + 1],
                idWidth == 2 ? BinaryPrimitives.ReadUInt16LittleEndian(payload.AsSpan(offset, 2)) : payload[offset]));

            offset += entrySize;
        }

        return result;
    }

    public static CompactModuleMarkerFrame? TryDecodeCompactModuleMarker(ReplayPacket packet)
    {
        if (packet.Type != ModuleChannel || packet.PayloadLength != 11 || packet.Payload[4] != 1)
        {
            return null;
        }

        var marker = packet.Payload[9];
        if (marker is not (0xa0 or 0xa4 or 0xa8 or 0xac or 0xad))
        {
            return null;
        }

        return new CompactModuleMarkerFrame(
            packet.Index,
            packet.Offset,
            packet.ClockSeconds,
            BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(0, 4)),
            marker,
            packet.Payload[10]);
    }
}
