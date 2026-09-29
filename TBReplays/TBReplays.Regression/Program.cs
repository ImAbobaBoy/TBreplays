using System.Buffers.Binary;
using System.Text.Json;
using System.IO.Compression;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using TBReplays.ClientGameData;
using TBReplays.Dvpl;
using TBReplays.Replays;
using TBReplays.Replays.Parser;

if (args.Length < 2) throw new ArgumentException("Usage: <backend directory containing ClientGameData> <replay> [replay ...]");
var environment = new TestEnvironment { ContentRootPath = Path.GetFullPath(args[0]) };
var loader = new ClientGameDataLoader(new ClientGameDataPathResolver(environment,
    Options.Create(new ClientGameDataOptions())), new DvplTextFileReader(new DvplDecoder()));
var catalog = loader.Load();
var service = new ReplayParseService();
var checks = 0;
void Check(bool value, string message)
{
    if (!value) throw new InvalidOperationException(message);
    checks++;
}
var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
foreach (var path in args.Skip(1))
{
    using var input = File.OpenRead(path);
    var result = service.Parse(input, catalog);
    var archive = TbreplayArchiveReader.Read(path);
    var header = ReplayDataParser.Parse(archive.DataReplayBytes).Header;
    var packets = ReplayPacketParser.ParsePackets(archive.DataReplayBytes, header.PacketStartOffset);
    var snapshotPackets = packets.Where(p => p.Type == 5 && result.Vehicles.Any(v => v.EntityId == BinaryPrimitives.ReadUInt32LittleEndian(p.Payload))).ToArray();
    var idWidth = header.ClientVersion.StartsWith("26.4.") ? 1 : 2;
    var snapshots = snapshotPackets.Select(p => VehicleSnapshotDecoder.TryDecode(p, idWidth)).OfType<VehicleSnapshot>().ToArray();
    Console.WriteLine($"{Path.GetFileName(path)} vehicles={result.Vehicles.Count} snapshots={snapshots.Length}/{snapshotPackets.Length} outcome={result.Outcome.WinnerTeamId}/{result.Outcome.FinishReasonCode} scores={result.ScoreEvents.Count} uses={result.ConsumableActivationEvents.Count}");
    Check(result.SchemaVersion == 2, "Schema version");
    Check(result.Vehicles.Count > 0, "Roster must be available");
    foreach (var vehicle in result.Vehicles)
    {
        Console.WriteLine($"  {vehicle.TeamId} {vehicle.Nickname}: HP={vehicle.InitialHealth} ({vehicle.EffectiveHpSource}); uses=" + string.Join(",", result.VehicleStatistics.Single(v => v.EntityId == vehicle.EntityId).Extras.Where(x => x.MinimumUses > 0).Select(x => $"{x.Key}:{x.DirectUses}+{x.InferredUses}")));
        if (vehicle.ResultDamageReceived + vehicle.ResultCurrentHp > 0)
            Check(vehicle.InitialHealth == Math.Max(0, vehicle.ResultCurrentHp ?? 0) + vehicle.ResultDamageReceived, "Initial HP/results mismatch: " + vehicle.Nickname);
        else Check(snapshots.Any(x => x.EntityId == vehicle.EntityId && x.MaxHealth == vehicle.InitialHealth), "Zero results need a snapshot");
        Check(vehicle.InitialHealth is > 0 && vehicle.InitialHealthIsExact, "Initial HP exact");
        Check(vehicle.InitialHealthTime == 0, "Initial HP time");
        foreach (var snapshot in snapshots.Where(s => s.EntityId == vehicle.EntityId))
            Check(snapshot.MaxHealth == vehicle.InitialHealth, "Snapshot max HP must match all spawns");
    }
    Check(result.HealthFrames.All(x => x.Health >= 0), "Negative health sent to UI");
    Check(result.DeathEvents.Select(x => x.EntityId).Distinct().Count() == result.DeathEvents.Count, "Duplicate death");
    Check(result.ConsumableActivationEvents.All(x => x.ExtraId is not (69 or 194 or 224)), "Passive/ability misclassified");
    Check(result.ScoreEvents.All(x => x.TeamId is 1 or 2), "Invalid team");
    Check(result.Teams.Sum(x => x.ConfirmedKills) == result.KillEvents.Count(k =>
        k.KillerEntityId is not null && result.Vehicles.Single(v => v.EntityId == k.KillerEntityId).TeamId
        != result.Vehicles.Single(v => v.EntityId == k.VictimEntityId).TeamId), "Suicide/teamkill must not count as enemy kill");
    foreach (var track in result.Playback.Vehicles)
    {
        Check(track.States.Select(x => x.Time).SequenceEqual(track.States.Select(x => x.Time).Order()), "Unordered states");
        Check(track.States.Select(x => x.Time).Distinct().Count() == track.States.Count, "Duplicate state time");
        Check(track.States[0].Time == 0, "Initial playback state");
        Check(track.States.All(x => x.HealthFraction is null or >= 0 and <= 1), "Invalid health fraction");
        var deadAt = result.DeathEvents.FirstOrDefault(x => x.EntityId == track.EntityId)?.Time;
        Check(track.States.Where(x => deadAt is not null && x.Time >= deadAt).All(x => !x.IsAlive && x.Health == 0), "Resurrection after death");
    }
    var serialized = JsonSerializer.Serialize(result, jsonOptions);
    Check(JsonSerializer.Deserialize<ReplayParseResult>(serialized, jsonOptions)?.Playback.Vehicles.Count == result.Vehicles.Count, "JSON roundtrip");
    var packetResults = BattleResultsParser.TryParsePackets(packets);
    if (packetResults is not null)
    {
        Check(packetResults.Vehicles.Count == result.Vehicles.Count, "Results packet roster");
        Check(packetResults.WinnerTeamId == result.Outcome.WinnerTeamId, "Results packet winner");
    }
    if (Path.GetFileName(path).Contains("14755568094373551"))
    {
        Check(result.Vehicles.Count == 14 && snapshots.Length == snapshotPackets.Length, "Second replay snapshots");
        Check(result.Outcome.WinnerTeamId == 2 && result.Outcome.Reason == "supremacy", "Supremacy outcome");
        Check(result.ScoreEvents.Count == 283, "All 283 score messages");
        Check(result.Teams.Single(x => x.TeamId == 1).FinalSupremacyPoints == 930, "930 points");
        Check(result.Teams.Single(x => x.TeamId == 2).FinalSupremacyPoints == 1000, "1000 points");
        Check(result.Teams.Single(x => x.TeamId == 2).ConfirmedKills == 5, "Five confirmed kills");
        var final = result.Playback.Scoreboard.Last().Teams;
        Check(final.Single(x => x.TeamId == 1).SupremacyPoints == 930 && final.Single(x => x.TeamId == 2).SupremacyPoints == 1000, "Final UI score");
        Check(final.Single(x => x.TeamId == 1).AliveCount == 2 && final.Single(x => x.TeamId == 2).AliveCount == 5, "Final alive counts");
        Check(result.Playback.Scoreboard.Count(x => Math.Abs(x.Time - 329.4494f) < .001f) == 1, "Atomic final scoreboard update");
        Check(JsonSerializer.Deserialize<ReplayParseResult>("{}", jsonOptions)?.SchemaVersion == 1, "Legacy JSON is not schema 2");
        var presentation = ReplayPresentationDto.FromResult(result);
        Check(presentation.Vehicles.All(x => x.ResultFields.Count == 0), "No protocol fields needed by presentation client");
        Check(presentation.Playback.Vehicles.Count == 14, "Presentation contains every tank");
        // Exercise the public parse service when battle_results.dat is absent or corrupt.
        foreach (var corrupt in new[] { false, true })
        {
            using var missingResults = new MemoryStream();
            using (var zip = new ZipArchive(missingResults, ZipArchiveMode.Create, true))
            {
                using (var entry = zip.CreateEntry("data.replay").Open()) entry.Write(archive.DataReplayBytes);
                using (var entry = zip.CreateEntry("meta.json").Open()) entry.Write(System.Text.Encoding.UTF8.GetBytes(archive.MetaJson!));
                if (corrupt)
                {
                    using var entry = zip.CreateEntry("battle_results.dat").Open();
                    entry.Write(new byte[] { 0x80, 2, 0x8a, 255 });
                }
            }
            missingResults.Position = 0;
            var recovered = service.Parse(missingResults, catalog);
            Check(recovered.Vehicles.Count == 14 && recovered.Outcome.WinnerTeamId == 2, "Recover results from final packet");
            Check(recovered.VehicleStatistics.Select(x => x.InitialHp).SequenceEqual(result.VehicleStatistics.Select(x => x.InitialHp)), "Recovered HP");
        }
        var expectedUses = new Dictionary<string, (int Direct, int Inferred)> { ["openAXAX"] = (2, 0), ["R1nd"] = (3, 0), ["NoSkill"] = (1, 0), ["NS_autism"] = (2, 0), ["stepanxPRIME"] = (2, 0), ["ll_yablo4ko_ll"] = (1, 0), ["HellBoom"] = (2, 0), ["coreeeshooock"] = (3, 0), ["RenamedUser_207209266"] = (2, 1), ["Lacoste05dag"] = (1, 1), ["kaly4n"] = (3, 0), ["__Etern1ty__"] = (0, 0), ["37iqOptimusPrime"] = (2, 0), ["Saayzer"] = (0, 1) };
        foreach (var v in result.VehicleStatistics)
        {
            var expected = expectedUses[v.Nickname];
            Check(v.Extras.Sum(x => x.DirectUses) == expected.Direct && v.Extras.Sum(x => x.InferredUses) == expected.Inferred, "Consumable count: " + v.Nickname);
        }
        var outPath = Environment.GetEnvironmentVariable("TBREPLAYS_REGRESSION_JSON");
        if (!string.IsNullOrWhiteSpace(outPath)) File.WriteAllText(outPath, serialized);
    }
    if (Path.GetFileName(path).Contains("1168275280041179379"))
    {
        Check(result.Vehicles.Count == 14 && snapshots.Length == snapshotPackets.Length, "First replay snapshots");
        Check(result.Outcome.WinnerTeamId == 1 && result.Outcome.Reason == "annihilation", "Annihilation outcome");
        Check(result.Teams.Single(x => x.TeamId == 1).ConfirmedKills == 7, "Seven confirmed kills");
    }
    foreach (var packet in packets.Where(x => ExtraEffectPacketDecoder.TryDecodeExtraState(x, idWidth) is not null).Take(1))
    {
        var clone = packet.Payload.ToArray(); clone[4] = 1;
        Check(ExtraEffectPacketDecoder.TryDecodeExtraState(packet with { Payload = clone }, idWidth) is null, "Module subtype must not be decoded as consumable");
        clone = packet.Payload.ToArray(); clone[^13] = 7;
        Check(ExtraEffectPacketDecoder.TryDecodeExtraState(packet with { Payload = clone }, idWidth)?.StateCode == 7, "Preserve unknown ability states");
    }
}
Check(BattleResultsParser.TryParse([0x80, 2, 0x8a, 255]) is null, "Truncated pickle");
try { ProtoReader.ReadFields([0]); throw new Exception("Field zero accepted"); }
catch (InvalidDataException) { checks++; }
try { ProtoReader.ReadFields([8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 2]); throw new Exception("Varint overflow accepted"); }
catch (InvalidDataException) { checks++; }
Console.WriteLine($"PASS: {checks} assertions");

sealed class TestEnvironment : IWebHostEnvironment
{
    public string ApplicationName { get; set; } = "TBReplays.Regression";
    public string EnvironmentName { get; set; } = "Development";
    public string ContentRootPath { get; set; } = "";
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public string WebRootPath { get; set; } = "";
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
}
