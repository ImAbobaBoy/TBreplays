namespace TBReplays.Replays.Parser;

public sealed record MovementSegmentFrame(
    int SegmentIndex,
    int PacketIndex,
    int PacketOffset,
    float ClockSeconds,
    uint EntityId,
    float X,
    float Y,
    float Z,
    float YawRadians,
    float PitchRadians,
    float RollRadians,
    int TeamId,
    string Nickname,
    uint VehicleCompactDescriptor);

public static class TrajectorySegmenter
{
    public static IReadOnlyList<MovementSegmentFrame> BuildSegments(
        IReadOnlyList<MovementFrame> movements,
        IReadOnlyDictionary<uint, VehicleBattleInfo> vehiclesByEntityId,
        double maxGapSeconds = 1.0,
        double maxStepDistanceXz = 30.0,
        double maxStepSpeedXz = 35.0)
    {
        var result = new List<MovementSegmentFrame>();

        foreach (var group in movements
                     .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
                     .GroupBy(x => x.EntityId)
                     .OrderBy(x => x.Key))
        {
            var vehicle = vehiclesByEntityId[group.Key];
            var ordered = group.OrderBy(x => x.ClockSeconds).ThenBy(x => x.PacketIndex).ToArray();
            var segmentIndex = 0;
            MovementFrame? previous = null;

            foreach (var current in ordered)
            {
                if (previous is not null && ShouldStartNewSegment(previous, current, maxGapSeconds, maxStepDistanceXz, maxStepSpeedXz))
                {
                    segmentIndex++;
                }

                result.Add(new MovementSegmentFrame(
                    segmentIndex,
                    current.PacketIndex,
                    current.PacketOffset,
                    current.ClockSeconds,
                    current.EntityId,
                    current.X,
                    current.Y,
                    current.Z,
                    current.YawRadians,
                    current.PitchRadians,
                    current.RollRadians,
                    vehicle.TeamId,
                    vehicle.Nickname,
                    vehicle.VehicleCompactDescriptor));

                previous = current;
            }
        }

        return result;
    }

    private static bool ShouldStartNewSegment(
        MovementFrame previous,
        MovementFrame current,
        double maxGapSeconds,
        double maxStepDistanceXz,
        double maxStepSpeedXz)
    {
        var dt = current.ClockSeconds - previous.ClockSeconds;
        if (dt <= 0)
        {
            return false;
        }

        var dx = current.X - previous.X;
        var dz = current.Z - previous.Z;
        var distance = Math.Sqrt(dx * dx + dz * dz);
        var speed = distance / dt;

        return dt > maxGapSeconds || distance > maxStepDistanceXz || speed > maxStepSpeedXz;
    }
}
