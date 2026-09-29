using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace TBReplays.Online;

public sealed class OnlineClaimsFactory(UserManager<OnlineUser> users, IOptions<IdentityOptions> options)
    : UserClaimsPrincipalFactory<OnlineUser>(users, options)
{
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(OnlineUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);
        identity.AddClaim(new Claim(ClaimTypes.Role, user.Role));
        return identity;
    }
}

public sealed class OnlineSecurity(OnlineUserStore users, IOptions<IdentityOptions> options)
{
    public async Task<OnlineUser?> GetCurrentAsync(ClaimsPrincipal? principal, CancellationToken ct = default)
    {
        if (principal?.Identity?.IsAuthenticated != true) return null;
        var id = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var stamp = principal.FindFirstValue(options.Value.ClaimsIdentity.SecurityStampClaimType);
        if (id is null || stamp is null) return null;
        var user = await users.FindByIdAsync(id, ct);
        return user?.SecurityStamp == stamp ? user : null;
    }
}
