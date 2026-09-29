using System.Globalization;
using System.Text.Json;

namespace TBReplays.Replays;

public sealed record ReplayMetaInfo(
    string? MapName,
    int? MapId,
    double? BattleDuration,
    long? RecorderAccountId = null);

public static class ReplayMetaJsonReader
{
    private static readonly HashSet<string> MapNamePropertyNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "mapName",
        "map",
        "arenaTypeId",
        "arenaTypeID",
        "arenaUniqueName",
        "arenaName",
        "arena"
    };

    private static readonly HashSet<string> MapIdPropertyNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "mapId",
        "arenaTypeID",
        "arenaTypeId"
    };

    private static readonly HashSet<string> BattleDurationPropertyNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "battleDuration",
        "duration",
        "arenaDuration"
    };

    public static ReplayMetaInfo Read(string? metaJson)
    {
        if (string.IsNullOrWhiteSpace(metaJson))
        {
            return new ReplayMetaInfo(null, null, null);
        }

        try
        {
            using var document = JsonDocument.Parse(metaJson);
            string? mapName = null;
            int? mapId = null;
            double? battleDuration = null;

            Visit(document.RootElement, (name, value) =>
            {
                mapName ??= TryReadMapName(name, value);
                mapId ??= TryReadMapId(name, value);
                battleDuration ??= TryReadBattleDuration(name, value);
            });

            var recorderAccountId = document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("dbid", out var dbid)
                && long.TryParse(dbid.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var accountId)
                    ? (long?)accountId : null;
            return new ReplayMetaInfo(NormalizeMapName(mapName), mapId, battleDuration, recorderAccountId);
        }
        catch (JsonException)
        {
            return new ReplayMetaInfo(null, null, null);
        }
    }

    private static void Visit(
        JsonElement element,
        Action<string, JsonElement> visitor)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                visitor(property.Name, property.Value);
                Visit(property.Value, visitor);
            }

            return;
        }

        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                Visit(item, visitor);
            }
        }
    }

    private static string? TryReadMapName(
        string propertyName,
        JsonElement value)
    {
        if (!MapNamePropertyNames.Contains(propertyName))
        {
            return null;
        }

        if (value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var rawValue = value.GetString();
        if (string.IsNullOrWhiteSpace(rawValue))
        {
            return null;
        }

        return rawValue;
    }

    private static int? TryReadMapId(
        string propertyName,
        JsonElement value)
    {
        if (!MapIdPropertyNames.Contains(propertyName))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var numberValue))
        {
            return numberValue;
        }

        if (value.ValueKind == JsonValueKind.String
            && int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var stringValue))
        {
            return stringValue;
        }

        return null;
    }

    private static double? TryReadBattleDuration(
        string propertyName,
        JsonElement value)
    {
        if (!BattleDurationPropertyNames.Contains(propertyName))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var numberValue))
        {
            return numberValue;
        }

        if (value.ValueKind == JsonValueKind.String
            && double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var stringValue))
        {
            return stringValue;
        }

        return null;
    }

    private static string? NormalizeMapName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value
            .Replace('\\', '/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .LastOrDefault();

        return string.IsNullOrWhiteSpace(normalized)
            ? value.Trim()
            : normalized.Trim();
    }
}
