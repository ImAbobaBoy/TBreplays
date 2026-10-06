namespace TBReplays.Replays.Parser;

public static class SpottingCandidateDecoder
{
    // This notification family is sent for allies. Flag 1 is a spotting candidate,
    // not a confirmed continuous visibility state. Keep raw evidence; do not render it yet.
    public static IReadOnlyList<ReplaySpottingCandidate> Decode(IReadOnlyList<ReplayPacket> packets,
        IReadOnlySet<uint> allies, string version)
    {
        if (!version.StartsWith("26.10.",StringComparison.Ordinal)) return [];
        var events = new List<ReplaySpottingCandidate>();
        foreach (var packet in packets)
        {
            var method=EntityMethodPacketDecoder.TryDecode(packet);
            if(method?.MethodId!=55) continue;
            var p=method.MethodPayload;
            if(p.Length<2 || p[0]!=16) continue;
            var header=p[1]==255?5:2;
            if(p.Length<header) continue;
            var length=header==2?p[1]:p[2]|p[3]<<8|p[4]<<16;
            if(length!=p.Length-header) continue;
            try {
                var body=ProtoReader.ReadFields(p[header..]).SingleOrDefault(x=>x.FieldNumber==15 && x.WireType==ProtoWireType.LengthDelimited);
                if(body is null) continue;
                var f=ProtoReader.ReadFields(body.BytesValue);
                var entity=ArenaEventDecoder.ReadInt(f,1);var type=ArenaEventDecoder.ReadInt(f,2);var flags=ArenaEventDecoder.ReadInt(f,3);
                if(entity is >0 && allies.Contains((uint)entity) && type==1 && flags==1)
                    events.Add(new(packet.ClockSeconds,packet.Index,(uint)entity,type.Value,flags.Value,
                        "arenaMethod55Type16",ReplayEventConfidences.Experimental,Convert.ToHexString(p)));
            } catch(Exception e) when(e is IOException or OverflowException or InvalidOperationException) { }
        }
        return events;
    }
}
