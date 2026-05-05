using System.Buffers.Binary;

namespace TBReplays.Replays.Parser;

public sealed record ReplayPacket(
    int Index,
    int Offset,
    int PayloadLength,
    uint Type,
    float ClockSeconds,
    byte[] Payload);

public static class ReplayPacketParser
{
    private const int PacketHeaderSize = 12;

    public static IReadOnlyList<ReplayPacket> ParsePackets(byte[] dataReplayBytes, int packetStartOffset)
    {
        var packets = new List<ReplayPacket>();
        var offset = packetStartOffset;
        var index = 0;

        while (offset < dataReplayBytes.Length)
        {
            var remaining = dataReplayBytes.Length - offset;
            if (remaining < PacketHeaderSize)
            {
                throw new InvalidDataException($"Trailing bytes after last packet: offset={offset}, remaining={remaining}.");
            }

            var packetOffset = offset;
            var payloadLength = BinaryPrimitives.ReadInt32LittleEndian(dataReplayBytes.AsSpan(offset, 4));
            offset += 4;

            var type = BinaryPrimitives.ReadUInt32LittleEndian(dataReplayBytes.AsSpan(offset, 4));
            offset += 4;

            var clockSeconds = ReadSingleLittleEndian(dataReplayBytes, offset);
            offset += 4;

            if (payloadLength < 0)
            {
                throw new InvalidDataException($"Negative payload length at packet offset {packetOffset}.");
            }

            if (offset + payloadLength > dataReplayBytes.Length)
            {
                throw new InvalidDataException(
                    $"Packet payload exceeds data.replay length. packetOffset={packetOffset}, payloadLength={payloadLength}.");
            }

            var payload = dataReplayBytes.AsSpan(offset, payloadLength).ToArray();
            offset += payloadLength;

            packets.Add(new ReplayPacket(
                index,
                packetOffset,
                payloadLength,
                type,
                clockSeconds,
                payload));

            index++;
        }

        return packets;
    }

    internal static float ReadSingleLittleEndian(byte[] bytes, int offset)
    {
        var intValue = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(offset, 4));
        return BitConverter.Int32BitsToSingle(intValue);
    }
}
