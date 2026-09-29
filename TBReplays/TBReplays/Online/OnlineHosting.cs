using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.RateLimiting;

namespace TBReplays.Online;

public static class OnlineHosting
{
    public static void AddOnline(this WebApplicationBuilder builder)
    {
        var services = builder.Services;
        services.AddSingleton<OnlineFiles>();
        services.AddSingleton<OnlineUserStore>();
        services.AddSingleton<IUserStore<OnlineUser>>(sp => sp.GetRequiredService<OnlineUserStore>());
        services.AddSingleton<OnlineSecurity>();
        services.AddSingleton<OnlineConnections>();
        services.AddSingleton<SketchService>();
        services.AddSingleton<TBReplays.Strategies.StrategySlideStorageService>();
        services.AddIdentityCore<OnlineUser>(options =>
        {
            options.Password.RequiredLength = 8;
            options.Password.RequireDigit = false;
            options.Password.RequireLowercase = false;
            options.Password.RequireUppercase = false;
            options.Password.RequireNonAlphanumeric = false;
            options.User.AllowedUserNameCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
            options.Lockout.MaxFailedAccessAttempts = 5;
            options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        }).AddSignInManager().AddDefaultTokenProviders();
        services.AddScoped<IUserClaimsPrincipalFactory<OnlineUser>, OnlineClaimsFactory>();
        services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
        services.ConfigureApplicationCookie(options =>
        {
            options.Cookie.Name = "TBReplays.Session";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            options.ExpireTimeSpan = TimeSpan.FromHours(8);
            options.SlidingExpiration = false;
            options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
            options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
            options.Events.OnValidatePrincipal = async context =>
            {
                var security = context.HttpContext.RequestServices.GetRequiredService<OnlineSecurity>();
                if (await security.GetCurrentAsync(context.Principal, context.HttpContext.RequestAborted) is not null) return;
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
            };
        });
        services.AddAuthorization(options => options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
        services.AddAntiforgery(options =>
        {
            options.HeaderName = "X-CSRF-TOKEN";
            options.Cookie.Name = "TBReplays.Csrf";
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        });
        services.AddSignalR(options =>
        {
            options.MaximumReceiveMessageSize = 512 * 1024;
            options.MaximumParallelInvocationsPerClient = 1;
            options.EnableDetailedErrors = false;
        });
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = 429;
            options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            foreach (var proxy in builder.Configuration.GetSection("Online:KnownProxies").Get<string[]>() ?? [])
                options.KnownProxies.Add(IPAddress.Parse(proxy));
        });
        var dataPath = Path.GetFullPath(builder.Configuration["Online:DataPath"]
            ?? Path.Combine(builder.Environment.ContentRootPath, "Data", "Online"));
        services.AddDataProtection().SetApplicationName("TBReplays.Online")
            .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataPath, "keys")));
    }

    public static async Task InitializeOnlineAsync(this WebApplication app)
    {
        _ = app.Services.GetRequiredService<SketchService>();
        using var scope = app.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<OnlineUserStore>();
        if ((await store.ListAsync(CancellationToken.None)).Count != 0) return;
        var users = scope.ServiceProvider.GetRequiredService<UserManager<OnlineUser>>();
        var admin = new OnlineUser { UserName = "admin", Role = OnlineRoles.Admin, LockoutEnabled = true };
        // The explicitly requested bootstrap password is the sole exception to the 8-character rule.
        admin.PasswordHash = users.PasswordHasher.HashPassword(admin, "admin");
        var result = await users.CreateAsync(admin);
        if (!result.Succeeded) throw new InvalidOperationException(string.Join("; ", result.Errors.Select(x => x.Description)));
    }

    public static void UseOnline(this WebApplication app)
    {
        app.UseForwardedHeaders();
        app.UseCors("WebClient");
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.StartsWithSegments("/hubs/sketch"))
            {
                // CORS does not protect WebSocket upgrades. Check their Origin explicitly.
                var origin = context.Request.Headers.Origin.ToString();
                var sameOrigin = $"{context.Request.Scheme}://{context.Request.Host}";
                var allowed = app.Configuration.GetSection("Online:AllowedOrigins").Get<string[]>() ?? [];
                if (origin.Length > 0 && origin != sameOrigin && !allowed.Contains(origin, StringComparer.OrdinalIgnoreCase))
                { context.Response.StatusCode = 403; return; }
            }
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.Headers.CacheControl = "no-store";
                if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)
                    && !HttpMethods.IsOptions(context.Request.Method))
                {
                    var antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>();
                    if (!await antiforgery.IsRequestValidAsync(context))
                    {
                        context.Response.StatusCode = 400;
                        await context.Response.WriteAsJsonAsync(new { error = "csrf", message = "Получите новый токен /api/auth/csrf и повторите запрос." });
                        return;
                    }
                }
            }
            await next(context);
        });
        app.MapHub<SketchHub>("/hubs/sketch", options => options.CloseOnAuthenticationExpiration = true);
    }
}
