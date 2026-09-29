using System.Text;

namespace TBReplays.Replays;

public static class ReplayMapNameMatcher
{
    public static bool IsMatch(
        string? candidateMapName,
        string? requestedMapName)
    {
        var candidate = Normalize(candidateMapName);
        var requested = Normalize(requestedMapName);

        if (string.IsNullOrWhiteSpace(candidate) || string.IsNullOrWhiteSpace(requested))
        {
            return false;
        }

        if (string.Equals(candidate, requested, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return HasToken(candidate, requested) || HasToken(requested, candidate);
    }

    public static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var builder = new StringBuilder(value.Length);
        var previousWasSeparator = false;

        foreach (var character in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                previousWasSeparator = false;
                continue;
            }

            if (!previousWasSeparator)
            {
                builder.Append('_');
                previousWasSeparator = true;
            }
        }

        return builder.ToString().Trim('_');
    }

    private static bool HasToken(
        string source,
        string token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return false;
        }

        return source == token
               || source.StartsWith(token + '_', StringComparison.OrdinalIgnoreCase)
               || source.EndsWith('_' + token, StringComparison.OrdinalIgnoreCase)
               || source.Contains('_' + token + '_', StringComparison.OrdinalIgnoreCase);
    }
}
