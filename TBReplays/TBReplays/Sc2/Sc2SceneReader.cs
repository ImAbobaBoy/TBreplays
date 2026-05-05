using System.Text;

namespace TBReplays.Sc2;

public sealed class Sc2SceneReader
{
    public Dictionary<string, object?> Read(byte[] bytes)
    {
        var reader = new Sc2KeyedArchiveReader(bytes);

        var magic = Encoding.ASCII.GetString(reader.ReadBytes(4));

        if (magic != "SFV2")
        {
            throw new InvalidDataException($"Некорректный SC2 magic: {magic}");
        }

        _ = reader.ReadUInt32();
        _ = reader.ReadUInt32();

        _ = reader.ReadArchive();

        var descriptorSize = checked((int)reader.ReadUInt32());
        reader.Skip(descriptorSize);

        var body = reader.ReadArchive();

        return body as Dictionary<string, object?>
               ?? throw new InvalidDataException("SC2 body не является KeyedArchive.");
    }
}