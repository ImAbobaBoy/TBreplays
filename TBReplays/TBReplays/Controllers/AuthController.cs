using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TBReplays.Online;

namespace TBReplays.Controllers;

[ApiController]
[Route("api/auth")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AuthController(UserManager<OnlineUser> users, SignInManager<OnlineUser> signIn,
    OnlineFiles files, OnlineSecurity security, OnlineConnections connections) : ControllerBase
{
    [AllowAnonymous, HttpGet("csrf")]
    public IActionResult Csrf([FromServices] IAntiforgery antiforgery) =>
        Ok(new { token = antiforgery.GetAndStoreTokens(HttpContext).RequestToken });

    [AllowAnonymous, HttpPost("register"), EnableRateLimiting("auth")]
    public async Task<IActionResult> Register(CredentialsRequest request)
    {
        await files.AccountGate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            var user = new OnlineUser { UserName = request.Login.Trim(), Role = OnlineRoles.Observer, LockoutEnabled = true };
            var result = await users.CreateAsync(user, request.Password);
            return result.Succeeded ? Ok(UserDto.From(user)) : BadRequest(new { errors = result.Errors });
        }
        finally { files.AccountGate.Release(); }
    }

    [AllowAnonymous, HttpPost("login"), EnableRateLimiting("auth")]
    public async Task<IActionResult> Login(CredentialsRequest request)
    {
        await files.AccountGate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            var user = await users.FindByNameAsync(request.Login.Trim());
            if (user is null) return Unauthorized(new { error = "Неверный логин или пароль либо вход временно заблокирован." });
            var result = await signIn.PasswordSignInAsync(user, request.Password, isPersistent: false, lockoutOnFailure: true);
            return result.Succeeded ? Ok(UserDto.From(user))
                : Unauthorized(new { error = "Неверный логин или пароль либо вход временно заблокирован." });
        }
        finally { files.AccountGate.Release(); }
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await security.GetCurrentAsync(User, HttpContext.RequestAborted);
        return user is null ? Unauthorized() : Ok(UserDto.From(user));
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await files.AccountGate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            var user = await security.GetCurrentAsync(User);
            if (user is null) return Unauthorized();
            var result = await users.UpdateSecurityStampAsync(user);
            if (!result.Succeeded) return Conflict(new { errors = result.Errors });
            connections.Revoke(user.Id);
            await signIn.SignOutAsync();
            return NoContent();
        }
        finally { files.AccountGate.Release(); }
    }

    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        await files.AccountGate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            var user = await security.GetCurrentAsync(User);
            if (user is null) return Unauthorized();
            var result = await users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
            if (!result.Succeeded) return BadRequest(new { errors = result.Errors });
            connections.Revoke(user.Id);
            await signIn.SignOutAsync();
            return NoContent();
        }
        finally { files.AccountGate.Release(); }
    }
}
