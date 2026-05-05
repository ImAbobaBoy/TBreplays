using System.Buffers.Binary;
using System.Text;

namespace TBReplays.Sc2;

internal sealed class Sc2KeyedArchiveReader
{
    private readonly byte[] _bytes;
    private readonly Dictionary<uint, string> _names = new();

    private int _offset;

    public Sc2KeyedArchiveReader(byte[] bytes)
    {
        _bytes = bytes;
    }

    public int Position => _offset;

    public byte[] ReadBytes(int count)
    {
        if (_offset + count > _bytes.Length)
        {
            throw new EndOfStreamException(
                $"SC2 read overflow. Offset={_offset}, count={count}, length={_bytes.Length}");
        }

        var result = _bytes.AsSpan(_offset, count).ToArray();
        _offset += count;

        return result;
    }

    public void Skip(int count)
    {
        ReadBytes(count);
    }

    public byte ReadByte()
    {
        var value = _bytes[_offset];
        _offset++;

        return value;
    }

    public sbyte ReadSByte()
    {
        return unchecked((sbyte)ReadByte());
    }

    public ushort ReadUInt16()
    {
        var value = BinaryPrimitives.ReadUInt16LittleEndian(_bytes.AsSpan(_offset, 2));
        _offset += 2;

        return value;
    }

    public short ReadInt16()
    {
        var value = BinaryPrimitives.ReadInt16LittleEndian(_bytes.AsSpan(_offset, 2));
        _offset += 2;

        return value;
    }

    public uint ReadUInt32()
    {
        var value = BinaryPrimitives.ReadUInt32LittleEndian(_bytes.AsSpan(_offset, 4));
        _offset += 4;

        return value;
    }

    public int ReadInt32()
    {
        var value = BinaryPrimitives.ReadInt32LittleEndian(_bytes.AsSpan(_offset, 4));
        _offset += 4;

        return value;
    }

    public ulong ReadUInt64()
    {
        var value = BinaryPrimitives.ReadUInt64LittleEndian(_bytes.AsSpan(_offset, 8));
        _offset += 8;

        return value;
    }

    public long ReadInt64()
    {
        var value = BinaryPrimitives.ReadInt64LittleEndian(_bytes.AsSpan(_offset, 8));
        _offset += 8;

        return value;
    }

    public float ReadSingle()
    {
        var value = BinaryPrimitives.ReadSingleLittleEndian(_bytes.AsSpan(_offset, 4));
        _offset += 4;

        return value;
    }

    public double ReadDouble()
    {
        var value = BinaryPrimitives.ReadDoubleLittleEndian(_bytes.AsSpan(_offset, 8));
        _offset += 8;

        return value;
    }

    public object? ReadArchive()
    {
        var magic = Encoding.ASCII.GetString(ReadBytes(2));

        if (magic != "KA")
        {
            throw new InvalidDataException($"Некорректный KeyedArchive magic: {magic}, offset={_offset - 2}");
        }

        var version = ReadUInt16();

        return version switch
        {
            1 => ReadArchiveVersion1(),
            2 => ReadArchiveVersion2(),
            0x0102 => ReadArchiveVersion0102(),
            0xff02 => new Dictionary<string, object?>(),
            _ => throw new NotSupportedException($"Неподдерживаемая версия KeyedArchive: {version}, offset={_offset}")
        };
    }

    private Dictionary<string, object?> ReadArchiveVersion1()
    {
        var count = ReadUInt32();
        var result = new Dictionary<string, object?>(checked((int)count));

        for (var i = 0; i < count; i++)
        {
            var key = ReadValue()?.ToString() ?? string.Empty;
            var value = ReadValue();

            result[key] = value;
        }

        return result;
    }

    private Dictionary<string, object?> ReadArchiveVersion2()
    {
        var namesCount = checked((int)ReadUInt32());

        var names = new string[namesCount];

        for (var i = 0; i < namesCount; i++)
        {
            var length = ReadUInt16();
            names[i] = Encoding.UTF8.GetString(ReadBytes(length));
        }

        for (var i = 0; i < namesCount; i++)
        {
            var id = ReadUInt32();
            _names[id] = names[i];
        }

        var count = checked((int)ReadUInt32());
        var result = new Dictionary<string, object?>(count);

        for (var i = 0; i < count; i++)
        {
            var keyId = ReadUInt32();
            var key = ResolveName(keyId);
            var value = ReadValue();

            result[key] = value;
        }

        return result;
    }

    private Dictionary<string, object?> ReadArchiveVersion0102()
    {
        var count = checked((int)ReadUInt32());
        var result = new Dictionary<string, object?>(count);

        for (var i = 0; i < count; i++)
        {
            var keyId = ReadUInt32();
            var key = ResolveName(keyId);
            var value = ReadValue(specialStringFastName: true);

            result[key] = value;
        }

        return result;
    }

    private object? ReadValue(bool specialStringFastName = false)
    {
        var type = ReadByte();

        return type switch
        {
            0 => null,
            1 => ReadByte() != 0,
            2 => ReadInt32(),
            3 => ReadSingle(),
            4 => specialStringFastName ? ResolveName(ReadUInt32()) : ReadString32(),
            5 => ReadWideString32(),
            6 => ReadByteArray(),
            7 => ReadUInt32(),
            8 => ReadSizedArchive(),
            9 => ReadInt64(),
            10 => ReadUInt64(),
            11 => ReadFloatArray(2),
            12 => ReadFloatArray(3),
            13 => ReadFloatArray(4),
            14 => ReadFloatArray(4),
            15 => ReadFloatArray(9),
            16 => ReadFloatArray(16),
            17 => ReadFloatArray(4),
            18 => ResolveName(ReadUInt32()),
            19 => new Sc2AabBox(ReadFloatArray(3), ReadFloatArray(3)),
            20 => ReadString32(),
            21 => ReadDouble(),
            22 => ReadSByte(),
            23 => ReadByte(),
            24 => ReadInt16(),
            25 => ReadUInt16(),
            27 => ReadArray(specialStringFastName),
            29 => ReadTransformValue(),
            _ => throw new NotSupportedException($"Неподдерживаемый SC2 value type: {type}, offset={_offset - 1}")
        };
    }

    private string ReadString32()
    {
        var length = checked((int)ReadUInt32());

        return Encoding.UTF8.GetString(ReadBytes(length));
    }

    private string ReadWideString32()
    {
        var length = checked((int)ReadUInt32());

        return Encoding.Unicode.GetString(ReadBytes(length * 2));
    }

    private byte[] ReadByteArray()
    {
        var length = checked((int)ReadUInt32());

        return ReadBytes(length);
    }

    private object? ReadSizedArchive()
    {
        var size = checked((int)ReadUInt32());
        var start = Position;

        var value = ReadArchive();

        var consumed = Position - start;

        if (consumed < size)
        {
            Skip(size - consumed);
        }

        if (consumed > size)
        {
            throw new InvalidDataException(
                $"KeyedArchive overread. Size={size}, consumed={consumed}, start={start}");
        }

        return value;
    }

    private List<object?> ReadArray(bool specialStringFastName)
    {
        var count = checked((int)ReadUInt32());
        var result = new List<object?>(count);

        for (var i = 0; i < count; i++)
        {
            result.Add(ReadValue(specialStringFastName));
        }

        return result;
    }

    private Dictionary<string, object?> ReadTransformValue()
    {
        return new Dictionary<string, object?>
        {
            ["position"] = ReadFloatArray(3),
            ["scale"] = ReadFloatArray(3),
            ["quaternion"] = ReadFloatArray(4)
        };
    }

    private float[] ReadFloatArray(int count)
    {
        var result = new float[count];

        for (var i = 0; i < count; i++)
        {
            result[i] = ReadSingle();
        }

        return result;
    }

    private string ResolveName(uint id)
    {
        return _names.TryGetValue(id, out var name)
            ? name
            : $"<fn:{id}>";
    }
}