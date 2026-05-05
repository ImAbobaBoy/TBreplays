using System.Buffers.Binary;
using System.Text;

namespace TBReplays.Replays.Parser;

public sealed record ReplayData(ReplayHeader Header);

public sealed record ReplayHeader(
    uint Magic,
    ulong UnknownU64,
    string ClientHash,
    string ClientVersion,
    byte ExtraByte,
    int PacketStartOffset);

public static class ReplayDataParser
{
    public static ReplayData Parse(byte[] dataReplayBytes)
    {
        var offset = 0;
        var magic = ReadUInt32(dataReplayBytes, ref offset);
        var unknownU64 = ReadUInt64(dataReplayBytes, ref offset);
        var clientHash = ReadLengthPrefixedAsciiString(dataReplayBytes, ref offset);
        var clientVersion = ReadLengthPrefixedAsciiString(dataReplayBytes, ref offset);
        var extraByte = ReadByte(dataReplayBytes, ref offset);

        var header = new ReplayHeader(
            magic,
            unknownU64,
            clientHash,
            clientVersion,
            extraByte,
            offset);

        return new ReplayData(header);
    }

    private static uint ReadUInt32(byte[] bytes, ref int offset)
    {
        EnsureCanRead(bytes, offset, sizeof(uint));
        var value = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(offset, sizeof(uint)));
        offset += sizeof(uint);
        return value;
    }

    private static ulong ReadUInt64(byte[] bytes, ref int offset)
    {
        EnsureCanRead(bytes, offset, sizeof(ulong));
        var value = BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(offset, sizeof(ulong)));
        offset += sizeof(ulong);
        return value;
    }

    private static byte ReadByte(byte[] bytes, ref int offset)
    {
        EnsureCanRead(bytes, offset, 1);
        return bytes[offset++];
    }

    private static string ReadLengthPrefixedAsciiString(byte[] bytes, ref int offset)
    {
        var length = ReadByte(bytes, ref offset);
        EnsureCanRead(bytes, offset, length);

        var value = Encoding.ASCII.GetString(bytes, offset, length);
        offset += length;
        return value;
    }

    private static void EnsureCanRead(byte[] bytes, int offset, int count)
    {
        if (offset < 0 || count < 0 || offset + count > bytes.Length)
        {
            throw new InvalidDataException("Unexpected end of data.replay header.");
        }
    }
}
