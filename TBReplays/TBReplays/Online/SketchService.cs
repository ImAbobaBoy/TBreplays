using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;

namespace TBReplays.Online;

public sealed class SketchService(OnlineFiles files, OnlineSecurity security,
    IHubContext<SketchHub> hub, ILogger<SketchService> logger)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private SketchDocument _document = files.Read("sketch.json", () => new SketchDocument());

    public async Task<SketchState> GetAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            // Returned objects never alias mutable storage.
            return JsonSerializer.Deserialize<SketchState>(JsonSerializer.Serialize(new SketchState(
                _document.Revision, _document.MapId, _document.MapRevision,
                _document.Strokes.Values.ToArray(), _document.Tanks.Values.ToArray()), OnlineFiles.Json), OnlineFiles.Json)!;
        }
        finally { _gate.Release(); }
    }

    public async Task<SketchResult> ApplyAsync(ClaimsPrincipal principal, SketchCommand command, CancellationToken ct = default)
    {
        // Same gate as role/reset operations: no write can pass after a revocation commits.
        await files.AccountGate.WaitAsync(ct);
        try
        {
            var user = await security.GetCurrentAsync(principal, ct);
            if (user is null) return new(false, "unauthorized", null);
            if (user.Role is not (OnlineRoles.Admin or OnlineRoles.Editor)) return new(false, "forbidden", null);
            var error = Validate(command);
            if (error is not null) return new(false, error, null);
            await _gate.WaitAsync(ct);
            try
            {
                var previous = _document.RecentOperations.FirstOrDefault(x => x.OperationId == command.OperationId);
                if (previous is not null)
                {
                    return previous.UserId == user.Id && previous.Kind == command.Kind
                        && previous.TankId == command.TankId
                        && JsonSerializer.Serialize(previous.Tank) == JsonSerializer.Serialize(command.Tank)
                        && previous.StrokeId == command.StrokeId && previous.MapId == command.MapId
                        && JsonSerializer.Serialize(previous.Stroke) == JsonSerializer.Serialize(command.Stroke)
                        ? new(true, null, previous) : new(false, "operationIdConflict", null);
                }
                if (command.MapRevision != _document.MapRevision) return new(false, "mapConflict", null);
                var next = JsonSerializer.Deserialize<SketchDocument>(JsonSerializer.Serialize(_document, OnlineFiles.Json), OnlineFiles.Json)!;
                var id = command.Stroke?.Id ?? command.StrokeId;
                if (command.Kind is "upsert" or "remove")
                {
                    if (_document.MapId is null) return new(false, "mapRequired", null);
                    if (_document.DeletedStrokeIds.Contains(id!)) return new(false, "revisionConflict", null);
                    var exists = _document.Strokes.TryGetValue(id!, out var stroke);
                    if (command.ExpectedRevision != (stroke?.Revision ?? 0)) return new(false, "revisionConflict", null);
                    if (command.Kind == "remove" && !exists) return new(false, "notFound", null);
                    if (command.Kind == "upsert")
                    {
                        if (!exists && next.Strokes.Count >= 1000) return new(false, "strokeLimit", null);
                        var pointCount = next.Strokes.Values.Sum(x => x.Stroke.Points.Length)
                            - (stroke?.Stroke.Points.Length ?? 0) + command.Stroke!.Points.Length;
                        if (pointCount > 100000) return new(false, "pointLimit", null);
                        next.Strokes[id!] = new(command.Stroke, next.Revision + 1, stroke?.AuthorId ?? user.Id);
                    }
                    else
                    {
                        if (next.DeletedStrokeIds.Count >= 10000) return new(false, "tombstoneLimit", null);
                        next.Strokes.Remove(id!);
                        next.DeletedStrokeIds.Add(id!);
                    }
                }
                else if (command.Kind is "upsertTank" or "removeTank")
                {
                    if (_document.MapId is null) return new(false, "mapRequired", null);
                    var tankId = command.Tank?.Id ?? command.TankId;
                    if (_document.DeletedTankIds.Contains(tankId!)) return new(false, "revisionConflict", null);
                    var exists = _document.Tanks.TryGetValue(tankId!, out var tank);
                    if (command.ExpectedRevision != (tank?.Revision ?? 0)) return new(false, "revisionConflict", null);
                    if (command.Kind == "removeTank" && !exists) return new(false, "notFound", null);
                    if (command.Kind == "upsertTank")
                    {
                        if (!exists && next.Tanks.Count >= 256) return new(false, "tankLimit", null);
                        next.Tanks[tankId!] = new(command.Tank!, next.Revision + 1, tank?.AuthorId ?? user.Id);
                    }
                    else
                    {
                        if (next.DeletedTankIds.Count >= 10000) return new(false, "tombstoneLimit", null);
                        next.Tanks.Remove(tankId!);
                        next.DeletedTankIds.Add(tankId!);
                    }
                }
                else
                {
                    if (command.ExpectedRevision != _document.Revision) return new(false, "revisionConflict", null);
                    if (command.Kind is "clear" or "setMap")
                    {
                        next.Strokes.Clear();
                        next.DeletedStrokeIds.Clear();
                    }
                    if (command.Kind is "clearTanks" or "setMap")
                    {
                        next.Tanks.Clear();
                        next.DeletedTankIds.Clear();
                    }
                    // Clear also changes the epoch so late/retried strokes cannot restore a cleared board.
                    next.MapRevision++;
                    if (command.Kind == "setMap") next.MapId = command.MapId;
                }
                next.Revision++;
                var change = new SketchChange(next.Revision, next.MapRevision, command.OperationId,
                    command.Kind, user.Id, command.Stroke, command.StrokeId, command.MapId, command.Tank, command.TankId);
                next.RecentOperations.Add(change);
                if (next.RecentOperations.Count > 256) next.RecentOperations.RemoveAt(0);
                await files.WriteAsync("sketch.json", next, ct);
                _document = next;
                // Once persisted, cancellation of the submitting HTTP request must not prevent broadcast.
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                try { await hub.Clients.All.SendAsync("SketchChanged", change, timeout.Token); }
                catch (Exception exception) { logger.LogWarning(exception, "Sketch change {Revision} persisted; broadcast failed", change.Revision); }
                return new(true, null, change);
            }
            finally { _gate.Release(); }
        }
        finally { files.AccountGate.Release(); }
    }

    private static string? Validate(SketchCommand? command)
    {
        if (command is null || !Guid.TryParse(command.OperationId, out _)
            || command.ExpectedRevision < 0 || command.MapRevision < 0) return "invalidCommand";
        if (command.Kind is not ("upsert" or "remove" or "clear" or "setMap" or "upsertTank" or "removeTank" or "clearTanks")) return "invalidKind";
        if (command.Kind is "upsertTank" or "removeTank" or "clearTanks")
        {
            if (command.Stroke is not null || command.StrokeId is not null || command.MapId is not null) return "invalidCommand";
            if (command.Kind == "clearTanks") return command.Tank is null && command.TankId is null ? null : "invalidCommand";
            if (command.Kind == "removeTank") return command.Tank is null && ValidId(command.TankId) ? null : "invalidTankId";
            return command.TankId is null && ValidTank(command.Tank) ? null : "invalidTank";
        }
        if (command.Tank is not null || command.TankId is not null) return "invalidCommand";
        if (command.Kind == "setMap")
            return command.Stroke is null && command.StrokeId is null && ValidId(command.MapId) ? null : "invalidMap";
        if (command.MapId is not null) return "invalidCommand";
        if (command.Kind == "clear") return command.Stroke is null && command.StrokeId is null ? null : "invalidCommand";
        if (command.Kind == "remove") return command.Stroke is null && ValidId(command.StrokeId) ? null : "invalidStrokeId";
        var stroke = command.Stroke;
        if (stroke is null || command.StrokeId is not null || !ValidId(stroke.Id)
            || stroke.Color is null || !Regex.IsMatch(stroke.Color, "^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant)
            || !double.IsFinite(stroke.Width) || stroke.Width <= 0 || stroke.Width > 100
            || stroke.Style is not ("solid" or "dashed") || stroke.ArrowMode is not ("none" or "dot" or "end")
            || stroke.Points is null || stroke.Points.Length is < 2 or > 4096) return "invalidStroke";
        return stroke.Points.All(p => p is not null && ValidCoordinate(p.X) && ValidCoordinate(p.Y) && ValidCoordinate(p.Z))
            ? null : "invalidPoints";
    }
    private static bool ValidTank(SketchTank? tank)
    {
        if (tank is null || !ValidId(tank.Id) || tank.CoordinateSpace != "viewer-world-v1"
            || tank.Label is null || tank.Label.Length > 80 || tank.Label.Any(char.IsControl)
            || tank.VisualKey is not ("light" or "medium" or "heavy" or "td")
            || tank.Team is not ("neutral" or "ally" or "enemy")
            || tank.Color is null || !Regex.IsMatch(tank.Color, "^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant)
            || tank.Pose is null) return false;
        var pose = tank.Pose;
        return ValidCoordinate(pose.X) && ValidCoordinate(pose.Y) && ValidCoordinate(pose.Z)
            && double.IsFinite(pose.BodyYawDegrees) && Math.Abs(pose.BodyYawDegrees) <= 360
            && double.IsFinite(pose.TurretYawDegrees) && Math.Abs(pose.TurretYawDegrees) <= 360
            && (tank.AimTarget is null || (ValidCoordinate(tank.AimTarget.X)
                && ValidCoordinate(tank.AimTarget.Y) && ValidCoordinate(tank.AimTarget.Z)));
    }
    private static bool ValidCoordinate(double value) => double.IsFinite(value) && Math.Abs(value) <= 100000;
    private static bool ValidId(string? id) => id is { Length: > 0 and <= 128 }
        && Regex.IsMatch(id, "^[a-zA-Z0-9_-]+$", RegexOptions.CultureInvariant);
}
