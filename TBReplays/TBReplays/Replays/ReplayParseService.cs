using TBReplays.Replays.Parser;

namespace TBReplays.Replays;

public sealed class ReplayParseService
{
    public ReplayParseResult Parse(Stream replayStream)
    {
        var archive = TbreplayArchiveReader.Read(replayStream);

        return Parse(archive);
    }

    private static ReplayParseResult Parse(TbreplayArchive archive)
    {
        var replayData = ReplayDataParser.Parse(archive.DataReplayBytes);

        var packets = ReplayPacketParser.ParsePackets(
            archive.DataReplayBytes,
            replayData.Header.PacketStartOffset);

        var battleResults = BattleResultsParser.TryParse(archive.BattleResultsBytes);

        var vehicles = battleResults?.Vehicles
            .Select(ToReplayVehicleInfo)
            .OrderBy(x => x.TeamId)
            .ThenBy(x => x.EntityId)
            .ToArray()
            ?? [];

        var vehiclesByEntityId = vehicles.ToDictionary(x => x.EntityId, x => x);

        var movementFrames = BuildMovementFrames(packets, vehiclesByEntityId);
        var turretFrames = BuildTurretFrames(packets, vehiclesByEntityId);
        var shotEvents = BuildShotEvents(packets, vehiclesByEntityId);

        var projectileIdsFromShots = shotEvents
            .Select(x => x.ProjectileId)
            .ToHashSet();

        var projectilePoints = BuildProjectilePoints(packets, projectileIdsFromShots);
        var healthFrames = BuildHealthFrames(packets, vehiclesByEntityId);

        return new ReplayParseResult
        {
            Vehicles = vehicles,
            MovementFrames = movementFrames,
            TurretFrames = turretFrames,
            ShotEvents = shotEvents,
            ProjectilePoints = projectilePoints,
            HealthFrames = healthFrames
        };
    }

    private static ReplayVehicleInfo ToReplayVehicleInfo(VehicleBattleInfo source)
    {
        return new ReplayVehicleInfo
        {
            EntityId = source.EntityId,
            AccountId = ToSignedAccountId(source.AccountId),
            Nickname = source.Nickname,
            TeamId = source.TeamId,
            VehicleCompactDescriptor = source.VehicleCompactDescriptor
        };
    }

    private static IReadOnlyList<ReplayMovementFrame> BuildMovementFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        var movementFrames = packets
            .Select(MovementPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .ToArray();

        var result = new List<ReplayMovementFrame>(movementFrames.Length);

        foreach (var group in movementFrames
                     .GroupBy(x => x.EntityId)
                     .OrderBy(x => x.Key))
        {
            var vehicle = vehiclesByEntityId[group.Key];

            var ordered = group
                .OrderBy(x => x.ClockSeconds)
                .ThenBy(x => x.PacketIndex)
                .ToArray();

            var segmentIndex = 0;
            MovementFrame? previous = null;

            foreach (var current in ordered)
            {
                if (previous is not null && ShouldStartNewSegment(previous, current))
                {
                    segmentIndex++;
                }

                result.Add(new ReplayMovementFrame
                {
                    Time = current.ClockSeconds,
                    EntityId = current.EntityId,
                    TeamId = vehicle.TeamId,
                    SegmentIndex = segmentIndex,

                    X = current.X,
                    Y = current.Y,
                    Z = current.Z,

                    YawRadians = current.YawRadians,
                    PitchRadians = current.PitchRadians,
                    RollRadians = current.RollRadians,

                    IsVolatile = current.IsVolatile
                });

                previous = current;
            }
        }

        return result
            .OrderBy(x => x.Time)
            .ThenBy(x => x.TeamId)
            .ThenBy(x => x.EntityId)
            .ThenBy(x => x.SegmentIndex)
            .ToArray();
    }

    private static IReadOnlyList<ReplayTurretFrame> BuildTurretFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(PropertyPacketDecoder.TryDecodeTurretYaw)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => new ReplayTurretFrame
            {
                Time = x.ClockSeconds,
                EntityId = x.EntityId,
                TurretYawRadians = x.TurretYawRadians
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayShotEvent> BuildShotEvents(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(EntityMethodPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .Select(EntityMethodPacketDecoder.TryDecodeShotFired)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.ShooterEntityId))
            .Select(x => new ReplayShotEvent
            {
                Time = x.ClockSeconds,
                ShooterEntityId = x.ShooterEntityId,
                ProjectileId = x.ProjectileId,
                ShotFlags = x.ShotFlags,

                OriginX = x.OriginX,
                OriginY = x.OriginY,
                OriginZ = x.OriginZ,

                DirectionX = x.DirectionOrVelocityX,
                DirectionY = x.DirectionOrVelocityY,
                DirectionZ = x.DirectionOrVelocityZ
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.ShooterEntityId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayProjectilePoint> BuildProjectilePoints(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlySet<uint> projectileIdsFromShots)
    {
        if (projectileIdsFromShots.Count == 0)
        {
            return [];
        }

        return packets
            .Select(EntityMethodPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .Select(EntityMethodPacketDecoder.TryDecodeProjectilePoint)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => projectileIdsFromShots.Contains(x.ProjectileId))
            .Select(x => new ReplayProjectilePoint
            {
                Time = x.ClockSeconds,
                ProjectileId = x.ProjectileId,

                X = x.X,
                Y = x.Y,
                Z = x.Z
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.ProjectileId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayHealthFrame> BuildHealthFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(PropertyPacketDecoder.TryDecodeHealth)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => new ReplayHealthFrame
            {
                Time = x.ClockSeconds,
                EntityId = x.EntityId,
                Health = x.Health
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ToArray();
    }

    private static bool ShouldStartNewSegment(
        MovementFrame previous,
        MovementFrame current)
    {
        const double maxGapSeconds = 1.0;
        const double maxStepDistanceXz = 30.0;
        const double maxStepSpeedXz = 35.0;

        var dt = current.ClockSeconds - previous.ClockSeconds;

        if (dt <= 0)
        {
            return false;
        }

        var dx = current.X - previous.X;
        var dz = current.Z - previous.Z;
        var distance = Math.Sqrt(dx * dx + dz * dz);
        var speed = distance / dt;

        return dt > maxGapSeconds
            || distance > maxStepDistanceXz
            || speed > maxStepSpeedXz;
    }

    private static long ToSignedAccountId(ulong accountId)
    {
        if (accountId <= long.MaxValue)
        {
            return (long)accountId;
        }

        return unchecked((long)accountId);
    }
}