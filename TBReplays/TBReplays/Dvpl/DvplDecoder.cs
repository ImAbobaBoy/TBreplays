using System.Buffers.Binary;
using System.Text;

namespace TBReplays.Dvpl;

public sealed class DvplDecoder
{
    private const int FooterSize = 20;

    private const uint NoCompression = 0;
    private const uint Lz4 = 1;
    private const uint Lz4Hc = 2;
    private static readonly uint[] CrcTable = CreateCrcTable();

    public byte[] DecodeFile(string path)
    {
        var bytes = File.ReadAllBytes(path);

        if (!path.EndsWith(".dvpl", StringComparison.OrdinalIgnoreCase))
        {
            return bytes;
        }

        return Decode(bytes);
    }

    public byte[] Decode(ReadOnlySpan<byte> dvpl)
    {
        if (dvpl.Length < FooterSize)
        {
            throw new InvalidDataException("Файл слишком маленький для DVPL.");
        }

        var footer = dvpl[^FooterSize..];

        var unpackedSize = BinaryPrimitives.ReadUInt32LittleEndian(footer[..4]);
        var compressedSize = BinaryPrimitives.ReadUInt32LittleEndian(footer.Slice(4, 4));
        var crc = BinaryPrimitives.ReadUInt32LittleEndian(footer.Slice(8, 4));
        var compressionType = BinaryPrimitives.ReadUInt32LittleEndian(footer.Slice(12, 4));
        var magic = footer.Slice(16, 4);

        if (!magic.SequenceEqual(Encoding.ASCII.GetBytes("DVPL")))
        {
            throw new InvalidDataException("Некорректный DVPL magic.");
        }

        var compressedSizeInt = checked((int)compressedSize);
        var unpackedSizeInt = checked((int)unpackedSize);

        if (compressedSizeInt != dvpl.Length - FooterSize)
        {
            throw new InvalidDataException("Некорректный compressed size в DVPL.");
        }

        var payload = dvpl[..compressedSizeInt];
        if (ComputeCrc32(payload) != crc)
        {
            throw new InvalidDataException("DVPL CRC32 не совпадает с payload.");
        }
        var output = new byte[unpackedSizeInt];

        switch (compressionType)
        {
            case NoCompression:
                if (payload.Length != output.Length)
                {
                    throw new InvalidDataException("Размер несжатого DVPL payload не совпадает с unpacked size.");
                }

                payload.CopyTo(output);
                return output;

            case Lz4:
            case Lz4Hc:
                DecodeLz4Block(payload, output);
                return output;

            default:
                throw new NotSupportedException($"Неподдерживаемый DVPL compression type: {compressionType}.");
        }
    }

    public static uint ComputeCrc32(ReadOnlySpan<byte> data)
    {
        var crc = uint.MaxValue;
        foreach (var value in data) crc = (crc >> 8) ^ CrcTable[(crc ^ value) & 255];
        return ~crc;
    }

    private static uint[] CreateCrcTable()
    {
        var table = new uint[256];
        for (uint i = 0; i < table.Length; i++)
        {
            var value = i;
            for (var bit = 0; bit < 8; bit++) value = (value >> 1) ^ ((value & 1) == 0 ? 0 : 0xedb88320u);
            table[i] = value;
        }
        return table;
    }

    private static void DecodeLz4Block(ReadOnlySpan<byte> source, Span<byte> destination)
    {
        var sourceIndex = 0;
        var destinationIndex = 0;

        while (sourceIndex < source.Length)
        {
            var token = source[sourceIndex++];

            var literalLength = token >> 4;

            if (literalLength == 15)
            {
                literalLength += ReadExtendedLength(source, ref sourceIndex);
            }

            if (sourceIndex + literalLength > source.Length)
            {
                throw new InvalidDataException("LZ4 literal выходит за пределы source.");
            }

            if (destinationIndex + literalLength > destination.Length)
            {
                throw new InvalidDataException("LZ4 literal выходит за пределы destination.");
            }

            source.Slice(sourceIndex, literalLength).CopyTo(destination[destinationIndex..]);

            sourceIndex += literalLength;
            destinationIndex += literalLength;

            if (sourceIndex >= source.Length)
            {
                break;
            }

            if (sourceIndex + 2 > source.Length)
            {
                throw new InvalidDataException("LZ4 match offset повреждён.");
            }

            var offset = source[sourceIndex] | (source[sourceIndex + 1] << 8);
            sourceIndex += 2;

            if (offset == 0 || offset > destinationIndex)
            {
                throw new InvalidDataException("Некорректный LZ4 match offset.");
            }

            var matchLength = token & 0x0F;

            if (matchLength == 15)
            {
                matchLength += ReadExtendedLength(source, ref sourceIndex);
            }

            matchLength += 4;

            if (destinationIndex + matchLength > destination.Length)
            {
                throw new InvalidDataException("LZ4 match выходит за пределы destination.");
            }

            var matchIndex = destinationIndex - offset;

            for (var i = 0; i < matchLength; i++)
            {
                destination[destinationIndex + i] = destination[matchIndex + i];
            }

            destinationIndex += matchLength;
        }

        if (destinationIndex != destination.Length)
        {
            throw new InvalidDataException("LZ4 распакован не до ожидаемого размера.");
        }
    }

    private static int ReadExtendedLength(ReadOnlySpan<byte> source, ref int sourceIndex)
    {
        var length = 0;

        while (true)
        {
            if (sourceIndex >= source.Length)
            {
                throw new InvalidDataException("LZ4 extended length повреждён.");
            }

            var value = source[sourceIndex++];
            length += value;

            if (value != 255)
            {
                return length;
            }
        }
    }
}
