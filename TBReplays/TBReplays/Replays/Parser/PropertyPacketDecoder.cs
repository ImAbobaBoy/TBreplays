using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public sealed record TurretYawFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    short RawValue,
    float TurretYawRadians)
{
    public double TurretYawDegrees => TurretYawRadians * 180.0 / Math.PI;
}

public sealed record HealthFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    short Health);

public sealed record VisibilityCandidateFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    bool Value);

public static class PropertyPacketDecoder
{
    public const uint PacketType = 7;

    public static TurretYawFrame? TryDecodeTurretYaw(ReplayPacket packet)
    {
        if (packet.Type != PacketType || packet.PayloadLength != 14)
        {
            return null;
        }

        var entityId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(0, 4));
        var propertyId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(4, 4));
        var valueByteCount = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(8, 4));
        if (propertyId != 2 || valueByteCount != 2)
        {
            return null;
        }

        var rawValue = BinaryPrimitives.ReadInt16LittleEndian(packet.Payload.AsSpan(12, 2));
        var radians = rawValue * MathF.PI / 32768.0f;

        return new TurretYawFrame(
            packet.Index,
            packet.Offset,
            packet.ClockSeconds,
            entityId,
            rawValue,
            radians);
    }

    public static HealthFrame? TryDecodeHealth(ReplayPacket packet)
    {
        if (packet.Type != PacketType || packet.PayloadLength != 14)
        {
            return null;
        }

        var entityId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(0, 4));
        var propertyId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(4, 4));
        var valueByteCount = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(8, 4));
        if (propertyId != 3 || valueByteCount != 2)
        {
            return null;
        }

        var health = BinaryPrimitives.ReadInt16LittleEndian(packet.Payload.AsSpan(12, 2));

        return new HealthFrame(
            packet.Index,
            packet.Offset,
            packet.ClockSeconds,
            entityId,
            health);
    }

    public static VisibilityCandidateFrame? TryDecodeVisibilityCandidate(ReplayPacket packet)
    {
        if (packet.Type != PacketType || packet.PayloadLength != 13)
        {
            return null;
        }

        var entityId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(0, 4));
        var propertyId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(4, 4));
        var valueByteCount = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(8, 4));
        if (propertyId != 0 || valueByteCount != 1)
        {
            return null;
        }

        return new VisibilityCandidateFrame(
            packet.Index,
            packet.Offset,
            packet.ClockSeconds,
            entityId,
            packet.Payload[12] != 0);
    }
}
