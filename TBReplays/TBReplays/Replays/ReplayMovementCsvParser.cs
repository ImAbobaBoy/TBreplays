using System.Globalization;

namespace TBReplays.Replays;

public sealed class ReplayMovementCsvParser
{
    public ReplayMovementSetDto Parse(
        string replayId,
        string? mapName,
        int? mapId,
        double? battleDuration,
        Stream csvStream)
    {
        using var reader = new StreamReader(csvStream);

        var headerLine = reader.ReadLine();

        if (string.IsNullOrWhiteSpace(headerLine))
        {
            throw new InvalidDataException("CSV с движением пустой.");
        }

        var headers = headerLine.Split(',');

        var clockIndex = GetColumnIndex(headers, "clock_secs");
        var entityIdIndex = GetColumnIndex(headers, "entity_id_dec");
        var entityHexIndex = GetColumnIndex(headers, "entity_id_hex");
        var xIndex = GetColumnIndex(headers, "x");
        var yIndex = GetColumnIndex(headers, "y");
        var zIndex = GetColumnIndex(headers, "z");
        var yawRadIndex = GetColumnIndex(headers, "yaw_rad");
        var yawDegIndex = GetColumnIndex(headers, "yaw_deg");

        var samplesByEntity = new Dictionary<long, List<ReplayMovementSampleDto>>();
        var hexByEntity = new Dictionary<long, string>();

        while (!reader.EndOfStream)
        {
            var line = reader.ReadLine();

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var columns = line.Split(',');

            var time = ParseDouble(columns[clockIndex]);
            var entityId = long.Parse(columns[entityIdIndex], CultureInfo.InvariantCulture);
            var entityHex = columns[entityHexIndex];

            var x = ParseFloat(columns[xIndex]);
            var y = ParseFloat(columns[yIndex]);
            var z = ParseFloat(columns[zIndex]);

            // В movements_type10 есть reset-точки 0,0,0.
            // Если их рисовать, линия улетает в центр карты и ломает трек.
            if (IsZeroResetPoint(x, y, z))
            {
                continue;
            }

            var yawRad = ParseFloat(columns[yawRadIndex]);
            var yawDeg = ParseFloat(columns[yawDegIndex]);

            if (!samplesByEntity.TryGetValue(entityId, out var samples))
            {
                samples = new List<ReplayMovementSampleDto>();
                samplesByEntity[entityId] = samples;
                hexByEntity[entityId] = entityHex;
            }

            var sample = new ReplayMovementSampleDto(
                Time: time,
                X: x,
                Y: y,
                Z: z,
                YawRad: yawRad,
                YawDeg: yawDeg);

            samples.Add(sample);
        }

        var tracks = samplesByEntity
            .Where(x => x.Value.Count >= 20)
            .Select(x =>
            {
                var samples = x.Value
                    .OrderBy(sample => sample.Time)
                    .ToArray();

                return new ReplayMovementTrackDto(
                    EntityId: x.Key,
                    EntityHex: hexByEntity[x.Key],
                    SamplesCount: samples.Length,
                    FirstTime: samples[0].Time,
                    LastTime: samples[^1].Time,
                    Samples: samples);
            })
            .OrderByDescending(x => x.SamplesCount)
            .ToArray();

        return new ReplayMovementSetDto(
            ReplayId: replayId,
            MapName: mapName,
            MapId: mapId,
            BattleDuration: battleDuration,
            TrackCount: tracks.Length,
            SampleCount: tracks.Sum(x => x.SamplesCount),
            Tracks: tracks);
    }

    private static int GetColumnIndex(string[] headers, string name)
    {
        var index = Array.FindIndex(
            headers,
            x => string.Equals(x, name, StringComparison.OrdinalIgnoreCase));

        if (index < 0)
        {
            throw new InvalidDataException($"В movements_type10.csv не найдена колонка: {name}");
        }

        return index;
    }

    private static float ParseFloat(string value)
    {
        return float.Parse(value, CultureInfo.InvariantCulture);
    }

    private static double ParseDouble(string value)
    {
        return double.Parse(value, CultureInfo.InvariantCulture);
    }

    private static bool IsZeroResetPoint(float x, float y, float z)
    {
        return MathF.Abs(x) < 0.0001f
            && MathF.Abs(y) < 0.0001f
            && MathF.Abs(z) < 0.0001f;
    }
}