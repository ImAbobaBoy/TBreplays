using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using TBReplays.Online;

namespace TBReplays.Controllers;

[ApiController, Route("api/users"), Authorize(Roles = OnlineRoles.Admin)]
public sealed class OnlineUsersController(UserManager<OnlineUser> users, OnlineUserStore store,
    OnlineFiles files, OnlineSecurity security, OnlineConnections connections, ReplaySyncService replays,
    IHubContext<SketchHub> hub, ILogger<OnlineUsersController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(await store.ListAsync(ct));

    [HttpPut("{id}/role")]
    public async Task<IActionResult> SetRole(string id, RoleRequest request)
    {
        if (request.Role is not (OnlineRoles.Editor or OnlineRoles.Observer)) return BadRequest(new { error = "Можно назначить только editor или observer." });
        UserDto updated;
        await files.AccountGate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            if ((await security.GetCurrentAsync(User))?.Role != OnlineRoles.Admin) return Forbid();
            var user = await users.FindByIdAsync(id);
            if (user is null) return NotFound();
            if (user.Role == OnlineRoles.Admin) return Conflict(new { error = "Роль администратора менять нельзя." });
            if (user.Role == request.Role) return Ok(UserDto.From(user));
            user.Role = request.Role;
            // A role change must not invalidate the login cookie. Authorization reads the current role from the store.
            var result = await users.UpdateAsync(user);
            if (!result.Succeeded) return Conflict(new { errors = result.Errors });
            updated = UserDto.From(user);
        }
        finally { files.AccountGate.Release(); }

        connections.Update(updated);
        await replays.RoleChangedAsync(updated.Id, updated.Role is OnlineRoles.Admin or OnlineRoles.Editor);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try { await hub.Clients.All.SendAsync("UsersChanged", connections.List(), timeout.Token); }
        catch (Exception error) { logger.LogWarning(error, "Role for user {UserId} persisted; UsersChanged broadcast failed", updated.Id); }
        return Ok(updated);
    }

    [HttpPost("{id}/reset-password")]
    public async Task<IActionResult> ResetPassword(string id, PasswordRequest request)
    {
        await files.AccountGate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            if ((await security.GetCurrentAsync(User))?.Role != OnlineRoles.Admin) return Forbid();
            var user = await users.FindByIdAsync(id);
            if (user is null) return NotFound();
            var token = await users.GeneratePasswordResetTokenAsync(user);
            // Reset lockout in the same persisted update as the new password and security stamp.
            user.LockoutEnd = null;
            user.AccessFailedCount = 0;
            var result = await users.ResetPasswordAsync(user, token, request.Password);
            if (!result.Succeeded) return BadRequest(new { errors = result.Errors });
            connections.Revoke(user.Id);
            return NoContent();
        }
        finally { files.AccountGate.Release(); }
    }
}
