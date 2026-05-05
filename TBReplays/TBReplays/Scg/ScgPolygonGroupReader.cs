using System.Buffers.Binary;
using System.Text;

namespace TBReplays.Scg;

public sealed class ScgPolygonGroupReader
{
    private static readonly HashSet<string> KnownKeys =
    [
        "##name",
        "#id",
        "packing",
        "indexCount",
        "indexFormat",
        "indices",
        "primitiveCount",
        "rhi_primitiveType",
        "textureCoordCount",
        "cubeTextureCoordCount",
        "vertexCount",
        "vertexFormat",
        "vertices"
    ];

    private byte[] _bytes = [];
    private int _offset;

    public IReadOnlyDictionary<ulong, ScgPolygonGroup> Read(byte[] bytes)
    {
        _bytes = bytes;
        _offset = 0;

        var magic = Encoding.ASCII.GetString(ReadBytes(4));

        if (magic != "SCPG")
        {
            throw new InvalidDataException($"Некорректный SCG magic: {magic}");
        }

        var version = ReadUInt32();

        if (version != 1)
        {
            throw new NotSupportedException($"Неподдерживаемая SCG version: {version}");
        }

        var groupCount = checked((int)ReadUInt32());

        _ = ReadUInt32();

        var groups = new Dictionary<ulong, ScgPolygonGroup>(groupCount);

        for (var i = 0; i < groupCount; i++)
        {
            var archive = ReadPolygonGroupArchive();

            if (!TryCreatePolygonGroup(archive, out var polygonGroup))
            {
                continue;
            }

            groups[polygonGroup.Id] = polygonGroup;
        }

        return groups;
    }

    private Dictionary<string, object?> ReadPolygonGroupArchive()
    {
        var magic = Encoding.ASCII.GetString(ReadBytes(2));

        if (magic != "KA")
        {
            throw new InvalidDataException($"Некорректный SCG KA magic: {magic}, offset={_offset - 2}");
        }

        var version = ReadUInt16();

        if (version != 1)
        {
            throw new NotSupportedException($"Для SCG ожидался KA version 1, получено: {version}");
        }

        var count = checked((int)ReadUInt32());
        var result = new Dictionary<string, object?>(count);

        for (var i = 0; i < count; i++)
        {
            var first = ReadValue();
            var second = ReadValue();

            if (first is string firstKey && KnownKeys.Contains(firstKey))
            {
                result[firstKey] = second;
                continue;
            }

            if (second is string secondKey && KnownKeys.Contains(secondKey))
            {
                result[secondKey] = first;
                continue;
            }

            if (first is string fallbackFirstKey)
            {
                result[fallbackFirstKey] = second;
                continue;
            }

            if (second is string fallbackSecondKey)
            {
                result[fallbackSecondKey] = first;
            }
        }

        return result;
    }

    private object? ReadValue()
    {
        var type = ReadByte();

        return type switch
        {
            2 => ReadInt32(),
            3 => ReadSingle(),
            4 => ReadString32(),
            6 => ReadByteArray(),
            7 => ReadUInt32(),
            20 => ReadString32(),
            _ => throw new NotSupportedException($"Неподдерживаемый SCG value type: {type}, offset={_offset - 1}")
        };
    }

    private bool TryCreatePolygonGroup(
        Dictionary<string, object?> archive,
        out ScgPolygonGroup polygonGroup)
    {
        polygonGroup = null!;

        if (!archive.TryGetValue("#id", out var idValue) ||
            idValue is not byte[] idBytes ||
            idBytes.Length != 8)
        {
            return false;
        }

        if (!TryGetInt32(archive, "vertexCount", out var vertexCount) ||
            !TryGetInt32(archive, "indexCount", out var indexCount) ||
            !TryGetInt32(archive, "vertexFormat", out var vertexFormat))
        {
            return false;
        }

        if (!archive.TryGetValue("vertices", out var verticesValue) ||
            verticesValue is not byte[] vertices)
        {
            return false;
        }

        if (!archive.TryGetValue("indices", out var indicesValue) ||
            indicesValue is not byte[] indices)
        {
            return false;
        }

        if (vertexCount <= 0 || indexCount <= 0)
        {
            return false;
        }

        if (vertices.Length % vertexCount != 0)
        {
            return false;
        }

        if (indices.Length < indexCount * sizeof(ushort))
        {
            return false;
        }

        var id = BinaryPrimitives.ReadUInt64LittleEndian(idBytes);
        var vertexStride = vertices.Length / vertexCount;

        if (vertexStride < 12)
        {
            return false;
        }

        polygonGroup = new ScgPolygonGroup(
            Id: id,
            VertexCount: vertexCount,
            IndexCount: indexCount,
            VertexFormat: vertexFormat,
            VertexStride: vertexStride,
            Vertices: vertices,
            Indices: indices);

        return true;
    }

    private static bool TryGetInt32(
        Dictionary<string, object?> archive,
        string key,
        out int value)
    {
        value = 0;

        if (!archive.TryGetValue(key, out var raw))
        {
            return false;
        }

        switch (raw)
        {
            case int intValue:
                value = intValue;
                return true;

            case uint uintValue when uintValue <= int.MaxValue:
                value = (int)uintValue;
                return true;

            default:
                return false;
        }
    }

    private byte[] ReadBytes(int count)
    {
        if (_offset + count > _bytes.Length)
        {
            throw new EndOfStreamException(
                $"SCG read overflow. Offset={_offset}, count={count}, length={_bytes.Length}");
        }

        var result = _bytes.AsSpan(_offset, count).ToArray();
        _offset += count;

        return result;
    }

    private byte ReadByte()
    {
        var value = _bytes[_offset];
        _offset++;

        return value;
    }

    private ushort ReadUInt16()
    {
        var value = BinaryPrimitives.ReadUInt16LittleEndian(_bytes.AsSpan(_offset, 2));
        _offset += 2;

        return value;
    }

    private uint ReadUInt32()
    {
        var value = BinaryPrimitives.ReadUInt32LittleEndian(_bytes.AsSpan(_offset, 4));
        _offset += 4;

        return value;
    }

    private int ReadInt32()
    {
        var value = BinaryPrimitives.ReadInt32LittleEndian(_bytes.AsSpan(_offset, 4));
        _offset += 4;

        return value;
    }

    private float ReadSingle()
    {
        var value = BinaryPrimitives.ReadSingleLittleEndian(_bytes.AsSpan(_offset, 4));
        _offset += 4;

        return value;
    }

    private string ReadString32()
    {
        var length = checked((int)ReadUInt32());

        return Encoding.UTF8.GetString(ReadBytes(length));
    }

    private byte[] ReadByteArray()
    {
        var length = checked((int)ReadUInt32());

        return ReadBytes(length);
    }
}