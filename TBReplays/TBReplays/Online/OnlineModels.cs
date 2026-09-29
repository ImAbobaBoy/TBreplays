using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Identity;

namespace TBReplays.Online;

public static class OnlineRoles
{
    public const string Admin = "admin";
    public const string Editor = "editor";
    public const string Observer = "observer";
    public const string Writers = Admin + "," + Editor;
    public static bool IsValid(string role) => role is Admin or Editor or Observer;
}

public sealed class OnlineUser : IdentityUser
{
    public string Role { get; set; } = OnlineRoles.Observer;
}

public sealed record UserDto(string Id, string Login, string Role)
{
    public static UserDto From(OnlineUser user) => new(user.Id, user.UserName!, user.Role);
}

public sealed record CredentialsRequest(
    [Required, StringLength(32, MinimumLength = 3)] string Login,
    [Required, StringLength(128, MinimumLength = 1)] string Password);
public sealed record RoleRequest([Required] string Role);
public sealed record PasswordRequest([Required, StringLength(128, MinimumLength = 8)] string Password);
public sealed record ChangePasswordRequest(
    [Required, StringLength(128)] string CurrentPassword,
    [Required, StringLength(128, MinimumLength = 8)] string NewPassword);

public sealed record SketchPoint(double X, double Y, double Z);
public sealed record SketchStroke(string Id, string Color, double Width, string Style,
    string ArrowMode, SketchPoint[] Points);
public sealed record StoredStroke(SketchStroke Stroke, long Revision, string AuthorId);
public sealed record SketchState(long Revision, string? MapId, long MapRevision,
    IReadOnlyList<StoredStroke> Strokes);
// ExpectedRevision is the stroke revision for upsert/remove, the board revision for clear/map.
// OperationId makes retries idempotent; MapRevision prevents a late stroke on a different map.
public sealed record SketchCommand(string OperationId, string Kind, long ExpectedRevision,
    long MapRevision, SketchStroke? Stroke = null, string? StrokeId = null, string? MapId = null);
public sealed record SketchChange(long Revision, long MapRevision, string OperationId, string Kind,
    string UserId, SketchStroke? Stroke, string? StrokeId, string? MapId);
public sealed record SketchResult(bool Applied, string? Error, SketchChange? Change);
public sealed class SketchDocument
{
    public long Revision { get; set; }
    public long MapRevision { get; set; }
    public string? MapId { get; set; }
    public Dictionary<string, StoredStroke> Strokes { get; set; } = [];
    public HashSet<string> DeletedStrokeIds { get; set; } = [];
    public List<SketchChange> RecentOperations { get; set; } = [];
}
