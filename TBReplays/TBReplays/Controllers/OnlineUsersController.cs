using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using TBReplays.Online;

namespace TBReplays.Controllers;

[ApiController, Route("api/users"), Authorize(Roles = OnlineRoles.Admin)]
public sealed class OnlineUsersController(UserManager<OnlineUser> users, OnlineUserStore store,
    OnlineFiles files, OnlineSecurity security, OnlineConnections connections) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(await store.ListAsync(ct));

    [HttpPut("{id}/role")]
    public async Task<IActionResult> SetRole(string id, RoleRequest request)
    {
        if (!OnlineRoles.IsValid(request.Role)) return BadRequest(new { error = "Допустимые роли: admin, editor, observer." });
        await files.AccountGate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            if ((await security.GetCurrentAsync(User))?.Role != OnlineRoles.Admin) return Forbid();
            var user = await users.FindByIdAsync(id);
            if (user is null) return NotFound();
            if (user.Role == request.Role) return Ok(UserDto.From(user));
            user.Role = request.Role;
            // Role and stamp are persisted atomically by the store.
            var result = await users.UpdateSecurityStampAsync(user);
            if (!result.Succeeded) return Conflict(new { errors = result.Errors });
            connections.Revoke(user.Id);
            return Ok(UserDto.From(user));
        }
        finally { files.AccountGate.Release(); }
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
