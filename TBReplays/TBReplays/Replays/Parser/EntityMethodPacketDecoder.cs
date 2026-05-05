using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public sealed record EntityMethodFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    uint MethodId,
    byte[] MethodPayload);

public sealed record ShotFiredEvent(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint ShooterEntityId,
    uint ProjectileId,
    byte ShotFlags,
    float OriginX,
    float OriginY,
    float OriginZ,
    float DirectionOrVelocityX,
    float DirectionOrVelocityY,
    float DirectionOrVelocityZ,
    float ExtraFloat);

public sealed record ProjectilePointEvent(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint ProjectileId,
    float X,
    float Y,
    float Z);

public sealed record ShotHitCandidateEvent(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint ProjectileId,
    byte[] RawPayload);

public static class EntityMethodPacketDecoder
{
    public const uint PacketType = 8;

    public static EntityMethodFrame? TryDecode(ReplayPacket packet)
    {
        if (packet.Type != PacketType || packet.PayloadLength < 12)
        {
            return null;
        }

        var entityId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(0, 4));
        var methodId = BinaryPrimitives.ReadUInt32LittleEndian(packet.Payload.AsSpan(4, 4));
        var methodPayloadLength = BinaryPrimitives.ReadInt32LittleEndian(packet.Payload.AsSpan(8, 4));
        if (methodPayloadLength < 0 || 12 + methodPayloadLength > packet.PayloadLength)
        {
            return null;
        }

        var methodPayload = packet.Payload.AsSpan(12, methodPayloadLength).ToArray();

        return new EntityMethodFrame(
            packet.Index,
            packet.Offset,
            packet.ClockSeconds,
            entityId,
            methodId,
            methodPayload);
    }

    public static ShotFiredEvent? TryDecodeShotFired(EntityMethodFrame method)
    {
        if (method.MethodId != 35 || method.MethodPayload.Length != 37)
        {
            return null;
        }

        var payload = method.MethodPayload;
        var shooterEntityId = BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(0, 4));
        var projectileId = BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(4, 4));
        var shotFlags = payload[8];
        var originX = ReadSingle(payload, 9);
        var originY = ReadSingle(payload, 13);
        var originZ = ReadSingle(payload, 17);
        var directionOrVelocityX = ReadSingle(payload, 21);
        var directionOrVelocityY = ReadSingle(payload, 25);
        var directionOrVelocityZ = ReadSingle(payload, 29);
        var extraFloat = ReadSingle(payload, 33);

        return new ShotFiredEvent(
            method.PacketIndex,
            method.PacketOffset,
            method.ClockSeconds,
            shooterEntityId,
            projectileId,
            shotFlags,
            originX,
            originY,
            originZ,
            directionOrVelocityX,
            directionOrVelocityY,
            directionOrVelocityZ,
            extraFloat);
    }

    public static ProjectilePointEvent? TryDecodeProjectilePoint(EntityMethodFrame method)
    {
        if (method.MethodId != 25 || method.MethodPayload.Length != 16)
        {
            return null;
        }

        var payload = method.MethodPayload;
        var projectileId = BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(0, 4));

        return new ProjectilePointEvent(
            method.PacketIndex,
            method.PacketOffset,
            method.ClockSeconds,
            projectileId,
            ReadSingle(payload, 4),
            ReadSingle(payload, 8),
            ReadSingle(payload, 12));
    }

    public static ShotHitCandidateEvent? TryDecodeShotHitCandidate(EntityMethodFrame method)
    {
        if (method.MethodId != 33 || method.MethodPayload.Length != 34)
        {
            return null;
        }

        var projectileId = BinaryPrimitives.ReadUInt32LittleEndian(method.MethodPayload.AsSpan(0, 4));

        return new ShotHitCandidateEvent(
            method.PacketIndex,
            method.PacketOffset,
            method.ClockSeconds,
            projectileId,
            method.MethodPayload);
    }

    private static float ReadSingle(byte[] bytes, int offset)
    {
        var intValue = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(offset, 4));
        return BitConverter.Int32BitsToSingle(intValue);
    }
}
