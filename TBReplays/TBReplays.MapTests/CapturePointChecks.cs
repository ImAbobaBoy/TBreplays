using System.Text.Json;
using TBReplays.Dvpl;
using TBReplays.Maps;
using TBReplays.Sc2;
using TBReplays.Replays.Parser;

static class CapturePointChecks
{
    public static void Run(string mapsDirectory, string replay)
    {
        var decoder = new DvplDecoder(); var reader = new Sc2SceneReader(); var checkedMaps = 0;
        foreach (var directory in Directory.EnumerateDirectories(mapsDirectory))
        {
            var name=Path.GetFileName(directory); var bundled=MapCapturePoints.GetBundled(name);
            if (bundled is null) continue;
            var source=decoder.DecodeFile(Path.Combine(directory,name+".sc2.dvpl"));
            var extracted=MapCapturePoints.Extract(name,reader.Read(source),source);
            if(JsonSerializer.Serialize(extracted)!=JsonSerializer.Serialize(bundled))
                throw new Exception($"Capture point catalog differs from source scene: {name}");
            checkedMaps++;
        }
        if(checkedMaps!=33) throw new Exception($"Expected all 33 Supremacy maps, checked {checkedMaps}");
        var archive=TbreplayArchiveReader.Read(replay);
        var header=ReplayDataParser.Parse(archive.DataReplayBytes).Header;
        var packets=ReplayPacketParser.ParsePackets(archive.DataReplayBytes,header.PacketStartOffset);
        var events=CapturePointPacketDecoder.Decode(packets,new HashSet<uint>(),header.ClientVersion);
        if(events.Count!=56 || events.Select(x=>x.PointId).Distinct().Count()!=3)
            throw new Exception("Skit capture event count mismatch");
        var a=events.First(x=>x.PointId==0 && x.OwnerTeamId==1);
        var c=events.First(x=>x.PointId==2 && x.OwnerTeamId==2);
        if(Math.Abs(a.Time-57.66)> .1 || Math.Abs(c.Time-73.16)> .1)
            throw new Exception("Capture completion differs from replay reference");
        if(CapturePointPacketDecoder.Decode(packets,new HashSet<uint>(),"unverified").Count!=0)
            throw new Exception("Unknown capture protocol must fail closed");
        var malformed=packets.Where(x=>x.Type==8).Select(x=>x with {Payload=x.Payload[..Math.Min(x.Payload.Length,13)],PayloadLength=Math.Min(x.Payload.Length,13)}).ToArray();
        if(CapturePointPacketDecoder.Decode(malformed,new HashSet<uint>(),header.ClientVersion).Count!=0)
            throw new Exception("Truncated capture messages accepted");
        Console.WriteLine($"PASS: {checkedMaps} source scenes / 107 exact capture points; 56 wire states, ownership, unknown and truncated protocols");
    }
}
