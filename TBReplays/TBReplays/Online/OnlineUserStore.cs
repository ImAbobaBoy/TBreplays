using Microsoft.AspNetCore.Identity;
using System.Text.Json;

namespace TBReplays.Online;

// Identity owns password hashing/validation/lockout. This provider only persists users.
public sealed class OnlineUserStore : IUserPasswordStore<OnlineUser>,
    IUserSecurityStampStore<OnlineUser>, IUserLockoutStore<OnlineUser>
{
    private readonly OnlineFiles _files;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary<string, OnlineUser> _users;

    public OnlineUserStore(OnlineFiles files)
    {
        _files = files;
        _users = files.Read("users.json", () => new Dictionary<string, OnlineUser>());
    }

    private static OnlineUser Copy(OnlineUser user) =>
        JsonSerializer.Deserialize<OnlineUser>(JsonSerializer.Serialize(user))!;

    public async Task<IReadOnlyList<UserDto>> ListAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try { return _users.Values.Select(UserDto.From).OrderBy(x => x.Login).ToArray(); }
        finally { _gate.Release(); }
    }

    public async Task<IdentityResult> CreateAsync(OnlineUser user, CancellationToken cancellationToken)
        => await SaveAsync(user, true, cancellationToken);
    public async Task<IdentityResult> UpdateAsync(OnlineUser user, CancellationToken cancellationToken)
        => await SaveAsync(user, false, cancellationToken);

    private async Task<IdentityResult> SaveAsync(OnlineUser user, bool create, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var errors = new IdentityErrorDescriber();
            if (create ? _users.ContainsKey(user.Id)
                : !_users.TryGetValue(user.Id, out var existing) || existing.ConcurrencyStamp != user.ConcurrencyStamp)
                return IdentityResult.Failed(errors.ConcurrencyFailure());
            if (_users.Values.Any(x => x.Id != user.Id && x.NormalizedUserName == user.NormalizedUserName))
                return IdentityResult.Failed(errors.DuplicateUserName(user.UserName!));
            if (!OnlineRoles.IsValid(user.Role)) return IdentityResult.Failed(errors.InvalidRoleName(user.Role));
            if (!create && _users[user.Id].Role == OnlineRoles.Admin && user.Role != OnlineRoles.Admin
                && _users.Values.Count(x => x.Role == OnlineRoles.Admin) == 1)
                return IdentityResult.Failed(new IdentityError { Code = "LastAdmin", Description = "Нельзя снять роль последнего администратора." });
            var saved = Copy(user);
            saved.ConcurrencyStamp = Guid.NewGuid().ToString();
            var next = new Dictionary<string, OnlineUser>(_users) { [user.Id] = saved };
            await _files.WriteAsync("users.json", next, cancellationToken);
            _users = next;
            user.ConcurrencyStamp = saved.ConcurrencyStamp;
            return IdentityResult.Success;
        }
        finally { _gate.Release(); }
    }

    public Task<IdentityResult> DeleteAsync(OnlineUser user, CancellationToken cancellationToken) =>
        Task.FromResult(IdentityResult.Failed(new IdentityError { Code = "NotSupported", Description = "Удаление пользователей не поддерживается." }));
    public async Task<OnlineUser?> FindByIdAsync(string userId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try { return _users.TryGetValue(userId, out var user) ? Copy(user) : null; }
        finally { _gate.Release(); }
    }
    public async Task<OnlineUser?> FindByNameAsync(string normalizedUserName, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var user = _users.Values.FirstOrDefault(x => x.NormalizedUserName == normalizedUserName);
            return user is null ? null : Copy(user);
        }
        finally { _gate.Release(); }
    }
    // Singleton lifetime is owned by DI; UserManager.Dispose must not dispose the shared store.
    public void Dispose() { }
    public Task<string> GetUserIdAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.Id);
    public Task<string?> GetUserNameAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.UserName);
    public Task SetUserNameAsync(OnlineUser user, string? name, CancellationToken ct) { user.UserName = name; return Task.CompletedTask; }
    public Task<string?> GetNormalizedUserNameAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.NormalizedUserName);
    public Task SetNormalizedUserNameAsync(OnlineUser user, string? name, CancellationToken ct) { user.NormalizedUserName = name; return Task.CompletedTask; }
    public Task SetPasswordHashAsync(OnlineUser user, string? hash, CancellationToken ct) { user.PasswordHash = hash; return Task.CompletedTask; }
    public Task<string?> GetPasswordHashAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.PasswordHash);
    public Task<bool> HasPasswordAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.PasswordHash != null);
    public Task SetSecurityStampAsync(OnlineUser user, string stamp, CancellationToken ct) { user.SecurityStamp = stamp; return Task.CompletedTask; }
    public Task<string?> GetSecurityStampAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.SecurityStamp);
    public Task<DateTimeOffset?> GetLockoutEndDateAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.LockoutEnd);
    public Task SetLockoutEndDateAsync(OnlineUser user, DateTimeOffset? end, CancellationToken ct) { user.LockoutEnd = end; return Task.CompletedTask; }
    public Task<int> IncrementAccessFailedCountAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(++user.AccessFailedCount);
    public Task ResetAccessFailedCountAsync(OnlineUser user, CancellationToken ct) { user.AccessFailedCount = 0; return Task.CompletedTask; }
    public Task<int> GetAccessFailedCountAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.AccessFailedCount);
    public Task<bool> GetLockoutEnabledAsync(OnlineUser user, CancellationToken ct) => Task.FromResult(user.LockoutEnabled);
    public Task SetLockoutEnabledAsync(OnlineUser user, bool enabled, CancellationToken ct) { user.LockoutEnabled = enabled; return Task.CompletedTask; }
}
