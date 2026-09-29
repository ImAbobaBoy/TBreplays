namespace TBReplays.ClientGameData;

public sealed class ClientGameDataOptions
{
    public string RootPath { get; init; } = "ClientGameData";
    public string? PreferredVersion { get; init; }
}
