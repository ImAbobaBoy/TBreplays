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
        return ReadOptionalEntry(archive, entryName)
            ?? throw new InvalidDataException($"Required replay entry '{entryName}' was not found.");
    }

    private static byte[]? ReadOptionalEntry(ZipArchive archive, string entryName)
    {
        var matches = archive.Entries.Where(x => x.FullName == entryName).ToArray();
        if (matches.Length > 1) throw new InvalidDataException($"Duplicate archive entry: {entryName}");
        var entry = matches.SingleOrDefault();
        return entry is null ? null : ReadEntry(entry);
    }

    private static byte[] ReadEntry(ZipArchiveEntry entry)
    {
        var limit = entry.FullName == "data.replay" ? 256 * 1024 * 1024 : 16 * 1024 * 1024;
        if (entry.Length > limit) throw new InvalidDataException($"Replay entry too large: {entry.FullName}");
        using var stream = entry.Open();
        using var memoryStream = new MemoryStream();
        var buffer = new byte[81920];
        var read = 0;
        while ((read = stream.Read(buffer)) > 0)
        {
            if (memoryStream.Length + read > limit) throw new InvalidDataException("Replay decompression limit exceeded.");
            memoryStream.Write(buffer, 0, read);
        }
        return memoryStream.ToArray();
    }
}
