using System.IO.Compression;
using System.Text;

namespace TBReplays.Replays.Parser;

public sealed record TbreplayArchive(
    byte[] DataReplayBytes,
    byte[]? BattleResultsBytes,
    string? MetaJson);

public static class TbreplayArchiveReader
{
    public static TbreplayArchive Read(string replayPath)
    {
        if (!File.Exists(replayPath))
        {
            throw new FileNotFoundException("Replay file was not found.", replayPath);
        }

        using var stream = File.OpenRead(replayPath);

        return Read(stream);
    }

    public static TbreplayArchive Read(Stream replayStream)
    {
        using var archive = new ZipArchive(
            replayStream,
            ZipArchiveMode.Read,
            leaveOpen: true);

        var dataReplay = ReadRequiredEntry(archive, "data.replay");
        var battleResults = ReadOptionalEntry(archive, "battle_results.dat");
        var metaBytes = ReadOptionalEntry(archive, "meta.json");
        var metaJson = metaBytes is null ? null : Encoding.UTF8.GetString(metaBytes);

        return new TbreplayArchive(dataReplay, battleResults, metaJson);
    }

    private static byte[] ReadRequiredEntry(ZipArchive archive, string entryName)
    {
        var entry = archive.GetEntry(entryName)
            ?? throw new InvalidDataException($"Required replay entry '{entryName}' was not found.");

        return ReadEntry(entry);
    }

    private static byte[]? ReadOptionalEntry(ZipArchive archive, string entryName)
    {
        var entry = archive.GetEntry(entryName);
        return entry is null ? null : ReadEntry(entry);
    }

    private static byte[] ReadEntry(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var memoryStream = new MemoryStream();
        stream.CopyTo(memoryStream);
        return memoryStream.ToArray();
    }
}
