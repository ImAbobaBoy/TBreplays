using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using TBReplays.Controllers;
using TBReplays.Online;

var directory = Path.Combine(Path.GetTempPath(), "tbreplays-online-tests-" + Guid.NewGuid().ToString("N"));
var checks = 0;
var app = await Start();
try
{
    var address = app.Urls.Single();
    var adminCookies = new CookieContainer();
    var viewerCookies = new CookieContainer();
    using var admin = Client(adminCookies, address);
    using var viewer = Client(viewerCookies, address);
    using var anonymous = Client(new CookieContainer(), address);
    await Expect(anonymous.GetAsync("/api/sketch"), 401);
    await Expect(anonymous.PostAsJsonAsync("/api/auth/login", new { login = "admin", password = "admin" }), 400);
    await Csrf(admin);
    await Expect(admin.PostAsJsonAsync("/api/auth/login", new { login = "admin", password = "admin" }), 200);
    await Csrf(admin);
    var adminUser = await Json(admin.GetAsync("/api/auth/me"));
    Check(adminUser["role"]!.GetValue<string>() == "admin", "seed administrator");
    await Csrf(viewer);
    var viewerUser = await Json(viewer.PostAsJsonAsync("/api/auth/register", new { login = "viewer", password = "password123", role = "admin" }));
    Check(viewerUser["role"]!.GetValue<string>() == "observer", "registration cannot elevate role");
    await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "password123" }), 200);
    await Csrf(viewer);
    var userId = viewerUser["id"]!.GetValue<string>();
    await Expect(viewer.GetAsync("/api/users"), 403);
    await Expect(viewer.PostAsJsonAsync("/api/strategy-slides", new { mapId = "test", title = "test" }), 403);
    await Expect(viewer.PostAsJsonAsync("/api/maps/import-local", new { }), 403);
    await Expect(viewer.PostAsJsonAsync("/api/sketch/commands", Command("clear", 0, 0)), 403);
    await Expect(admin.PutAsJsonAsync($"/api/users/{adminUser["id"]!.GetValue<string>()}/role", new { role = "observer" }), 409);
    await Expect(admin.PutAsJsonAsync($"/api/users/{userId}/role", new { role = "admin" }), 400);
    await Expect(admin.PutAsJsonAsync($"/api/users/{userId}/role", new { role = "editor" }), 200);
    await Expect(viewer.GetAsync("/api/auth/me"), 401);
    await Csrf(viewer);
    await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "password123" }), 200);
    await Csrf(viewer);

    using var socketA = await Socket(adminCookies, address);
    using var socketB = await Socket(viewerCookies, address);
    var setMap = Command("setMap", 0, 0, mapId: "test-map");
    var mapped = await Json(admin.PostAsJsonAsync("/api/sketch/commands", setMap));
    Check(mapped["applied"]!.GetValue<bool>(), "map selected");
    await Event(socketB, "SketchChanged", 1);
    var replay = await ReplaySnapshot(socketA);
    Check(replay["replayId"] is null, "room starts without replay");
    var missing = await ReplayCommand(socketA, replay, "load", "missing");
    Check(missing["error"]!.GetValue<string>() == "replayUnavailable", "missing replay rejected");
    var wrongMap = await ReplayCommand(socketA, replay, "load", "wrong-map");
    Check(wrongMap["error"]!.GetValue<string>() == "replayMapMismatch", "replay requires common map");
    var loadedReplay = await ReplayCommand(socketB, replay, "load", "fixture");
    Check(loadedReplay["applied"]!.GetValue<bool>(), "editor loads shared replay");
    replay = loadedReplay["state"]!;
    Check(replay["leaderId"]!.GetValue<string>() == userId && replay["maxTime"]!.GetValue<double>() == 120, "loader is leader, server owns bounds");
    var late = await ReplaySnapshot(socketA);
    Check(late["sessionId"]!.GetValue<string>() == replay["sessionId"]!.GetValue<string>(), "participants receive current replay id and session");
    var foreignTick = await ReplayTick(socketA, replay, 0, false, 1);
    Check(foreignTick["error"]!.GetValue<string>() == "notLeader", "other editor cannot publish timing");
    using (var secondTab = await Socket(viewerCookies, address))
    {
        var tabTick = await ReplayTick(secondTab, replay, 0, false, 1);
        Check(tabTick["error"]!.GetValue<string>() == "notLeader", "same account other tab is not clock leader");
    }
    var playingReplay = await ReplayCommand(socketA, replay, "play");
    Check(playingReplay["state"]!["isPlaying"]!.GetValue<bool>(), "another editor can play");
    var stale = await ReplayCommand(socketB, replay, "seek", time: 30);
    Check(stale["error"]!.GetValue<string>() == "replayConflict", "stale control rejected");
    replay = playingReplay["state"]!;
    var seekedReplay = await ReplayCommand(socketA, replay, "seek", time: 1.25);
    Check(seekedReplay["state"]!["time"]!.GetValue<double>() == 1.25, "fractional seek retained");
    var oldTick = await ReplayTick(socketB, replay, 0, true, 1);
    Check(oldTick["error"]!.GetValue<string>() == "replayConflict", "old leader timing cannot undo seek");
    replay = seekedReplay["state"]!;
    var sped = await ReplayCommand(socketB, replay, "speed", speed: 2);
    replay = sped["state"]!;
    Check(replay["speed"]!.GetValue<double>() == 2, "speed shared");
    var tick = await ReplayTick(socketB, replay, 10, true, 2);
    Check(tick["applied"]!.GetValue<bool>() && tick["state"]!["revision"]!.GetValue<long>() == replay["revision"]!.GetValue<long>()
        && tick["state"]!["sequence"]!.GetValue<long>() > replay["sequence"]!.GetValue<long>(), "timing changes sequence but not control revision");
    replay = tick["state"]!;
    var paused = await ReplayCommand(socketA, replay, "pause");
    replay = paused["state"]!;
    Check(!replay["isPlaying"]!.GetValue<bool>() && replay["time"]!.GetValue<double>() >= 10, "pause projects latest clock anchor");
    var badSpeed = await ReplayCommand(socketA, replay, "speed", speed: 100);
    Check(badSpeed["error"]!.GetValue<string>() == "invalidSpeed", "invalid speed rejected");
    var clamped = await ReplayCommand(socketA, replay, "seek", time: 999);
    replay = clamped["state"]!;
    Check(replay["time"]!.GetValue<double>() == 120, "seek clamped to replay bounds");
    var restart = await ReplayCommand(socketB, replay, "play");
    replay = restart["state"]!;
    Check(replay["time"]!.GetValue<double>() == 0, "play at end restarts replay");
    var stroke = new SketchStroke("line-1", "#22c55e", 2, "solid", "end", [new(0, 0, 0), new(10, 0, 10)]);
    var add = Command("upsert", 0, 1, stroke);
    await Send(socketB, new { type = 1, invocationId = "draw", target = "Apply", arguments = new[] { add } });
    await Event(socketA, "SketchChanged", 2);
    var completion = await Completion(socketB, "draw");
    Check(completion["result"]?["applied"]?.GetValue<bool>() == true, "editor draws over websocket");
    var duplicate = await Json(viewer.PostAsJsonAsync("/api/sketch/commands", add));
    Check(duplicate["change"]!["revision"]!.GetValue<long>() == 2, "retry is idempotent");
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", Command("upsert", 0, 1, stroke)), 409);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", Command("upsert", 2, 1, stroke with { Color = "javascript:bad" })), 400);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", Command("clear", 1, 1)), 409);
    var current = await Json(viewer.GetAsync("/api/sketch"));
    Check(current["strokes"]!.AsArray().Count == 1 && current["revision"]!.GetValue<long>() == 2, "shared board unchanged by conflict");
    var first = admin.PostAsJsonAsync("/api/sketch/commands", Command("upsert", 2, 1, stroke with { Width = 3 }));
    var second = viewer.PostAsJsonAsync("/api/sketch/commands", Command("upsert", 2, 1, stroke with { Width = 4 }));
    var concurrent = await Task.WhenAll(first, second);
    Check(concurrent.Count(x => x.StatusCode == HttpStatusCode.OK) == 1 && concurrent.Count(x => x.StatusCode == HttpStatusCode.Conflict) == 1, "one conflicting editor wins");
    foreach (var response in concurrent) response.Dispose();
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", Command("clear", 3, 1)), 200);
    await Expect(viewer.PostAsJsonAsync("/api/sketch/commands", Command("upsert", 0, 1, stroke with { Id = "late-line" })), 409);
    await Expect(admin.PutAsJsonAsync($"/api/users/{userId}/role", new { role = "observer" }), 200);
    await Closed(socketB);
    var disconnectedReplay = await ReplaySnapshot(socketA);
    Check(disconnectedReplay["leaderConnectionId"] is null && !disconnectedReplay["isPlaying"]!.GetValue<bool>(), "leader role revocation pauses replay");
    await Expect(viewer.PostAsJsonAsync("/api/sketch/commands", Command("clear", 4, 2)), 401);
    await Csrf(viewer);
    await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "password123" }), 200);
    await Csrf(viewer);
    using var observerSocket = await Socket(viewerCookies, address);
    await Send(observerSocket, new { type = 1, invocationId = "forbidden", target = "Apply", arguments = new[] { Command("clear", 4, 2) } });
    var forbidden = await Completion(observerSocket, "forbidden");
    var observerReplay = await ReplaySnapshot(observerSocket);
    var forbiddenLoad = await ReplayCommand(observerSocket, observerReplay, "load", "fixture");
    Check(forbiddenLoad["error"]!.GetValue<string>() == "forbidden", "observer cannot select replay");
    var forbiddenPlay = await ReplayCommand(observerSocket, observerReplay, "play");
    Check(forbiddenPlay["error"]!.GetValue<string>() == "forbidden", "observer cannot control playback");
    var noLeader = await ReplayCommand(socketA, observerReplay, "play");
    Check(noLeader["error"]!.GetValue<string>() == "leaderOffline", "cannot start without leader");
    var takeover = await ReplayCommand(socketA, observerReplay, "load", "fixture");
    Check(takeover["applied"]!.GetValue<bool>(), "editor can take over by selecting replay");
    Check(forbidden["result"]?["error"]?.GetValue<string>() == "forbidden", "observer websocket cannot draw");
    await Expect(admin.PostAsJsonAsync($"/api/users/{userId}/reset-password", new { password = "new-password123" }), 204);
    await Closed(observerSocket);
    await Expect(viewer.GetAsync("/api/auth/me"), 401);
    await Csrf(viewer);
    await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "password123" }), 401);
    await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "new-password123" }), 200);
    await Csrf(viewer);
    await Expect(viewer.PostAsJsonAsync("/api/auth/logout", new { }), 204);
    await Expect(viewer.GetAsync("/api/auth/me"), 401);
    using var badOrigin = new HttpRequestMessage(HttpMethod.Post, "/hubs/sketch/negotiate?negotiateVersion=1");
    badOrigin.Headers.Add("Origin", "https://untrusted.example");
    await Expect(admin.SendAsync(badOrigin), 403);
    await Csrf(viewer);
    for (var attempt = 0; attempt < 5; attempt++)
        await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "incorrect-password" }), 401);
    await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "new-password123" }), 401);
    await Expect(admin.PostAsJsonAsync($"/api/users/{userId}/reset-password", new { password = "unlocked-password" }), 204);
    await Expect(viewer.PostAsJsonAsync("/api/auth/login", new { login = "viewer", password = "unlocked-password" }), 200);
    var removable = Command("upsert", 0, 2, stroke with { Id = "removable" });
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", removable), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", new SketchCommand(Guid.NewGuid().ToString(), "remove", 5, 2, StrokeId: "removable")), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", removable), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", Command("upsert", 0, 2, stroke with { Id = "removable" })), 409);
    var removed = await Json(admin.GetAsync("/api/sketch"));
    Check(removed["strokes"]!.AsArray().Count == 0 && removed["revision"]!.GetValue<long>() == 6, "retry cannot resurrect deleted stroke");
    await Csrf(viewer);
    var tank = new SketchTank("tank-1", "viewer-world-v1", "ИС-7", "heavy", "ally", "#22c55e", new(1, 0, 2, 0, 0));
    var createTank = TankCommand("upsertTank", 0, 2, tank);
    await Expect(viewer.PostAsJsonAsync("/api/sketch/commands", createTank), 403);
    var addedTank = await Json(admin.PostAsJsonAsync("/api/sketch/commands", createTank));
    Check(addedTank["change"]!["tank"]!["id"]!.GetValue<string>() == "tank-1", "tank is included in broadcast change");
    await Event(socketA, "SketchChanged", 7);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", createTank), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", createTank with { Tank = tank with { Label = "other" } }), 409);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 7, 2, tank with { Color = "bad" })), 400);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 7, 2, tank with { CoordinateSpace = "unknown" })), 400);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 7, 2, tank with { Label = new string('x', 81) })), 400);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 7, 2, tank with { AimTarget = new(999999, 0, 0) })), 400);
    var aimed = tank with { AimTarget = new(100, 0, 200), Pose = tank.Pose with { TurretYawDegrees = 30 } };
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 7, 2, aimed)), 200);
    var moveA = admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 8, 2, aimed with { Pose = aimed.Pose with { X = 5 } }));
    var moveB = admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 8, 2, aimed with { Pose = aimed.Pose with { X = 10 } }));
    var moves = await Task.WhenAll(moveA, moveB);
    Check(moves.Count(x => x.StatusCode == HttpStatusCode.OK) == 1 && moves.Count(x => x.StatusCode == HttpStatusCode.Conflict) == 1, "concurrent tank move conflict");
    foreach (var response in moves) response.Dispose();
    var tankBoard = await Json(admin.GetAsync("/api/sketch"));
    Check(tankBoard["tanks"]![0]!["tank"]!["aimTarget"]!["x"]!.GetValue<double>() == 100, "movement retains aim target");
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("removeTank", 9, 2, tankId: tank.Id)), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", createTank), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 0, 2, tank)), 409);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 0, 2, tank with { Id = "tank-2" })), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", Command("upsert", 0, 2, stroke with { Id = "keep-line" })), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("clearTanks", 12, 2)), 200);
    var clearedTanks = await Json(admin.GetAsync("/api/sketch"));
    Check(clearedTanks["tanks"]!.AsArray().Count == 0 && clearedTanks["strokes"]!.AsArray().Count == 1, "clear tanks preserves lines");
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 11, 2, tank with { Id = "tank-2" })), 409);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", TankCommand("upsertTank", 0, 3, aimed)), 200);
    await Expect(admin.PostAsJsonAsync("/api/sketch/commands", Command("clear", 14, 3)), 200);
    var clearedLines = await Json(admin.GetAsync("/api/sketch"));
    Check(clearedLines["tanks"]!.AsArray().Count == 1 && clearedLines["strokes"]!.AsArray().Count == 0, "clear lines preserves tanks");
    await Expect(admin.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "admin", newPassword = "admin-new-password" }), 204);
    await Closed(socketA);
    var usersJson = await File.ReadAllTextAsync(Path.Combine(directory, "users.json"));
    Check(!usersJson.Contains("admin-new-password") && !usersJson.Contains("new-password123"), "passwords are hashed");
    await app.StopAsync();
    await app.DisposeAsync();
    app = await Start();
    using var restarted = Client(new CookieContainer(), app.Urls.Single());
    await Csrf(restarted);
    await Expect(restarted.PostAsJsonAsync("/api/auth/login", new { login = "admin", password = "admin" }), 401);
    await Expect(restarted.PostAsJsonAsync("/api/auth/login", new { login = "admin", password = "admin-new-password" }), 200);
    var saved = await Json(restarted.GetAsync("/api/sketch"));
    Check(saved["revision"]!.GetValue<long>() == 15 && saved["mapId"]!.GetValue<string>() == "test-map", "board survives restart");
    Check(saved["tanks"]![0]!["tank"]!["aimTarget"]!["z"]!.GetValue<double>() == 200, "tank and aim survive restart");
    await Csrf(restarted);
    await Expect(restarted.PostAsJsonAsync("/api/sketch/commands", Command("setMap", 15, 4, mapId: "next-map")), 200);
    var newMap = await Json(restarted.GetAsync("/api/sketch"));
    Check(newMap["tanks"]!.AsArray().Count == 0, "map switch clears tanks");
    Console.WriteLine($"PASS: {checks} online integration checks (HTTP, two WebSockets, roles, reset, concurrency, persistence).");
}
finally
{
    await app.StopAsync();
    await app.DisposeAsync();
    Directory.Delete(directory, true);
}

async Task<WebApplication> Start()
{
    var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development", ApplicationName = typeof(AuthController).Assembly.FullName });
    builder.Logging.ClearProviders();
    builder.Configuration["Online:DataPath"] = directory;
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Services.AddControllers().AddApplicationPart(typeof(AuthController).Assembly);
    builder.AddOnline();
    builder.Services.AddSingleton<IReplaySyncCatalog, TestReplayCatalog>();
    builder.Services.AddCors(options => options.AddPolicy("WebClient", policy => policy.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
    var web = builder.Build();
    await web.InitializeOnlineAsync();
    web.UseOnline();
    web.MapControllers();
    await web.StartAsync();
    return web;
}
HttpClient Client(CookieContainer cookies, string address) => new(new HttpClientHandler { CookieContainer = cookies }) { BaseAddress = new Uri(address), Timeout = TimeSpan.FromSeconds(10) };
void Check(bool condition, string label) { if (!condition) throw new Exception(label); checks++; }
async Task Expect(Task<HttpResponseMessage> request, int status)
{
    using var response = await request;
    Check((int)response.StatusCode == status, $"Expected {status}, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
}
async Task<JsonNode> Json(Task<HttpResponseMessage> request)
{
    using var response = await request;
    var text = await response.Content.ReadAsStringAsync();
    Check(response.IsSuccessStatusCode, $"HTTP {(int)response.StatusCode}: {text}");
    return JsonNode.Parse(text)!;
}
async Task Csrf(HttpClient client)
{
    var result = await Json(client.GetAsync("/api/auth/csrf"));
    client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
    client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", result["token"]!.GetValue<string>());
}
SketchCommand Command(string kind, long revision, long mapRevision, SketchStroke? stroke = null, string? mapId = null)
    => new(Guid.NewGuid().ToString(), kind, revision, mapRevision, stroke, MapId: mapId);
async Task<ClientWebSocket> Socket(CookieContainer cookies, string address)
{
    var socket = new ClientWebSocket();
    socket.Options.Cookies = cookies;
    socket.Options.SetRequestHeader("Origin", address);
    await socket.ConnectAsync(new Uri(address.Replace("http:", "ws:") + "/hubs/sketch"), CancellationToken.None);
    await Send(socket, new { protocol = "json", version = 1 });
    return socket;
}
async Task Send(ClientWebSocket socket, object message)
{
    var bytes = Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(message, OnlineFiles.Json) + "\u001e");
    await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
}
async Task<JsonNode> Until(ClientWebSocket socket, Func<JsonNode, bool> predicate)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    var buffer = new byte[512 * 1024];
    var pending = "";
    while (true)
    {
        var received = await socket.ReceiveAsync(buffer, timeout.Token);
        if (received.MessageType == WebSocketMessageType.Close) throw new Exception("Unexpected websocket close");
        pending += Encoding.UTF8.GetString(buffer, 0, received.Count);
        var parts = pending.Split('\u001e');
        pending = parts[^1];
        foreach (var part in parts[..^1])
        {
            var node = JsonNode.Parse(part)!;
            if (predicate(node)) { checks++; return node; }
        }
    }
}
async Task Event(ClientWebSocket socket, string target, long revision) =>
    _ = await Until(socket, node => node["target"]?.GetValue<string>() == target && node["arguments"]?[0]?["revision"]?.GetValue<long>() == revision);
async Task<JsonNode> Completion(ClientWebSocket socket, string id) => await Until(socket, node => node["invocationId"]?.GetValue<string>() == id);
async Task Closed(ClientWebSocket socket)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
    try
    {
        var buffer = new byte[512 * 1024];
        while (true)
        {
            var received = await socket.ReceiveAsync(buffer, timeout.Token);
            if (received.MessageType == WebSocketMessageType.Close) break;
        }
    }
    catch (WebSocketException) { }
    checks++;
}

SketchCommand TankCommand(string kind, long revision, long epoch, SketchTank? tank = null, string? tankId = null)
    => new(Guid.NewGuid().ToString(), kind, revision, epoch, Tank: tank, TankId: tankId);

async Task<JsonNode> ReplayCall(ClientWebSocket socket, string target, params object[] arguments)
{
    var id = Guid.NewGuid().ToString();
    await Send(socket, new { type = 1, invocationId = id, target, arguments });
    return (await Completion(socket, id))["result"]!;
}
Task<JsonNode> ReplaySnapshot(ClientWebSocket socket) => ReplayCall(socket, "GetReplay");
Task<JsonNode> ReplayCommand(ClientWebSocket socket, JsonNode state, string kind, string? replayId = null, double? time = null, double? speed = null)
    => ReplayCall(socket, "ReplayApply", new ReplaySyncCommand(Guid.NewGuid().ToString(), kind,
        state["sessionId"]!.GetValue<string>(), state["revision"]!.GetValue<long>(), replayId, time, speed));
Task<JsonNode> ReplayTick(ClientWebSocket socket, JsonNode state, double time, bool playing, double speed)
    => ReplayCall(socket, "ReplayHeartbeat", new ReplayTiming(state["sessionId"]!.GetValue<string>(),
        state["revision"]!.GetValue<long>(), time, playing, speed, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));

sealed class TestReplayCatalog : IReplaySyncCatalog
{
    public Task<ReplaySyncInfo?> ReadAsync(string replayId, CancellationToken ct) => Task.FromResult<ReplaySyncInfo?>(replayId switch
    {
        "fixture" => new(0, 120, "test-map", null),
        "wrong-map" => new(0, 120, "other-map", null),
        _ => null
    });
}
