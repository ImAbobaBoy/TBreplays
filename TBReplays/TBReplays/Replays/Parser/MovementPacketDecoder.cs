using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public sealed record MovementFrame(
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    uint VehicleOrFieldU32,
    uint UnknownU32,
    float X,
    float Y,
    float Z,
    float PositionErrorX,
    float PositionErrorY,
    float PositionErrorZ,
    float YawRadians,
    float PitchRadians,
    float RollRadians,
    bool IsVolatile)
{
    public double YawDegrees => YawRadians * 180.0 / Math.PI;
    public double PitchDegrees => PitchRadians * 180.0 / Math.PI;
    public double RollDegrees => RollRadians * 180.0 / Math.PI;
}

public static class MovementPacketDecoder
{
    public const uint PacketType = 10;
    public const int PayloadLength = 49;

    public static MovementFrame? TryDecode(ReplayPacket packet)
    {
        if (packet.Type != PacketType || packet.PayloadLength != PayloadLength)
        {
            return null;
        }

        var offset = 0;
        var entityId = ReadUInt32(packet.Payload, ref offset);
        var vehicleOrFieldU32 = ReadUInt32(packet.Payload, ref offset);
        var unknownU32 = ReadUInt32(packet.Payload, ref offset);
        var x = ReadSingle(packet.Payload, ref offset);
        var y = ReadSingle(packet.Payload, ref offset);
        var z = ReadSingle(packet.Payload, ref offset);
        var positionErrorX = ReadSingle(packet.Payload, ref offset);
        var positionErrorY = ReadSingle(packet.Payload, ref offset);
        var positionErrorZ = ReadSingle(packet.Payload, ref offset);
        var yawRadians = ReadSingle(packet.Payload, ref offset);
        var pitchRadians = ReadSingle(packet.Payload, ref offset);
        var rollRadians = ReadSingle(packet.Payload, ref offset);
        var isVolatile = packet.Payload[offset] != 0;

        return new MovementFrame(
            packet.Index,
            packet.Offset,
            packet.ClockSeconds,
            entityId,
            vehicleOrFieldU32,
            unknownU32,
            x,
            y,
            z,
            positionErrorX,
            positionErrorY,
            positionErrorZ,
            yawRadians,
            pitchRadians,
            rollRadians,
            isVolatile);
    }

    private static uint ReadUInt32(byte[] bytes, ref int offset)
    {
        var value = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset, 4));
        offset += 4;
        return value;
    }

    private static float ReadSingle(byte[] bytes, ref int offset)
    {
        var intValue = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(offset, 4));
        offset += 4;
        return BitConverter.Int32BitsToSingle(intValue);
    }
}
