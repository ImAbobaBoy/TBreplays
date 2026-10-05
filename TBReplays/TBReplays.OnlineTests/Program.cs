using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using TBReplays.Controllers;
using TBReplays.Online;

var directory = Path.Combine(Path.GetTempPath(), "tbreplays-online-tests-" + Guid.NewGuid().ToString("N"));
var checks = 0;
var observed = new List<JsonNode>();
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
    await Expect(viewer.PostAsJsonAsync("/api/maps/import-all", new { }), 403);
    await Expect(viewer.PostAsJsonAsync("/api/sketch/commands", Command("clear", 0, 0)), 403);
    await Expect(admin.PutAsJsonAsync($"/api/users/{adminUser["id"]!.GetValue<string>()}/role", new { role = "observer" }), 409);
    await Expect(admin.PutAsJsonAsync($"/api/users/{userId}/role", new { role = "admin" }), 400);
    await Expect(admin.PutAsJsonAsync($"/api/users/{userId}/role", new { role = "editor" }), 200);
    var promoted = await Json(viewer.GetAsync("/api/auth/me"));
    Check(promoted["role"]!.GetValue<string>() == "editor", "role promotion keeps session and is visible immediately");

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
    var downgraded = await Json(viewer.GetAsync("/api/auth/me"));
    Check(downgraded["role"]!.GetValue<string>() == "observer", "role downgrade keeps session and updates current role");
    var roleChangedReplay = await ReplaySnapshot(socketA);
    Check(roleChangedReplay["leaderConnectionId"] is null && !roleChangedReplay["isPlaying"]!.GetValue<bool>(), "leader role downgrade pauses replay without disconnect");
    await Expect(viewer.PostAsJsonAsync("/api/sketch/commands", Command("clear", 4, 2)), 403);
    await Send(socketB, new { type = 1, invocationId = "forbidden", target = "Apply", arguments = new[] { Command("clear", 4, 2) } });
    var forbidden = await Completion(socketB, "forbidden");
    var observerReplay = await ReplaySnapshot(socketB);
    var forbiddenLoad = await ReplayCommand(socketB, observerReplay, "load", "fixture");
    Check(forbiddenLoad["error"]!.GetValue<string>() == "forbidden", "observer cannot select replay");
    var forbiddenPlay = await ReplayCommand(socketB, observerReplay, "play");
    Check(forbiddenPlay["error"]!.GetValue<string>() == "forbidden", "observer cannot control playback");
    var noLeader = await ReplayCommand(socketA, observerReplay, "play");
    Check(noLeader["error"]!.GetValue<string>() == "leaderOffline", "cannot start without leader");
    var takeover = await ReplayCommand(socketA, observerReplay, "load", "fixture");
    Check(takeover["applied"]!.GetValue<bool>(), "editor can take over by selecting replay");
    Check(forbidden["result"]?["error"]?.GetValue<string>() == "forbidden", "observer websocket cannot draw");
    await Expect(admin.PostAsJsonAsync($"/api/users/{userId}/reset-password", new { password = "new-password123" }), 204);
    await Closed(socketB);
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
    var restartedCookies = new CookieContainer();
    using var restarted = Client(restartedCookies, app.Urls.Single());
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
    var editorCookies = new CookieContainer();
    using var editor = Client(editorCookies, app.Urls.Single());
    await Csrf(editor);
    var editorUser = await Json(editor.PostAsJsonAsync("/api/auth/register", new { login = "slide-editor", password = "password123" }));
    await Expect(editor.PostAsJsonAsync("/api/auth/login", new { login = "slide-editor", password = "password123" }), 200);
    var editorId = editorUser["id"]!.GetValue<string>();
    await Expect(restarted.PutAsJsonAsync($"/api/users/{editorId}/role", new { role = "editor" }), 200);
    using var slideA = await Socket(restartedCookies, app.Urls.Single());
    using var slideB = await Socket(editorCookies, app.Urls.Single());
    async Task<JsonNode> Workspace(string kind, string? id = null, string? sourceId = null) {
        var current = await ReplayCall(slideA, "GetWorkspace");
        var result = await ReplayCall(slideA, "WorkspaceApply", new WorkspaceCommand(Guid.NewGuid().ToString(), kind,
            current["revision"]!.GetValue<long>(), id, "test-map", "Canal tactic", sourceId));
        Check(result["applied"]!.GetValue<bool>(), "workspace " + kind); return result;
    }
    await Workspace("add", "slide-a"); await Workspace("add", "slide-b");
    await ReplayCall(slideA, "SelectSlide", "slide-a"); await ReplayCall(slideB, "SelectSlide", "slide-b");
    async Task<JsonNode> Edit(ClientWebSocket socket, string kind, SketchStroke? drawing = null, long entityRevision = 0, SketchTank? vehicle = null, string? strokeId = null) {
        var board = await ReplayCall(socket, "GetState");
        return await ReplayCall(socket, "Apply", new SketchCommand(Guid.NewGuid().ToString(), kind,
            kind is "undo" or "redo" or "clear" or "clearTanks" ? board["revision"]!.GetValue<long>() : entityRevision,
            board["mapRevision"]!.GetValue<long>(), drawing, StrokeId: strokeId, Tank: vehicle, SlideId: board["slideId"]!.GetValue<string>()));
    }
    var isolated = stroke with { Id = "isolated-line" };
    observed.Clear();
    var created = await Edit(slideA, "upsert", isolated);
    Check(created["applied"]!.GetValue<bool>(), "slide drawing saved");
    observed.Clear();
    var independent = await ReplayCall(slideB, "GetState");
    Check(independent["strokes"]!.AsArray().Count == 0, "same map on two slides has independent drawings");
    Check(!observed.Any(node => node["target"]?.GetValue<string>() == "SketchChanged" && node["arguments"]?[0]?["stroke"]?["id"]?.GetValue<string>() == "isolated-line"), "other slide receives no drawing event");
    var point = isolated with { Id = "point-marker", Style = "marker", Points = [new(15, 2, 20)] };
    Check((await Edit(slideB, "upsert", point))["applied"]!.GetValue<bool>(), "single-point marker accepted");
    var session = await ReplaySnapshot(slideA);
    Check((await ReplayCommand(slideA, session, "load", "fixture"))["applied"]!.GetValue<bool>(), "replay loaded on first slide");
    Check((await ReplaySnapshot(slideB))["replayId"] is null, "second slide has independent replay clock");
    Check((await ReplayCommand(slideA, await ReplaySnapshot(slideA), "seek", time: 37))["applied"]!.GetValue<bool>(), "seek first slide to 37");
    Check((await ReplayCommand(slideB, await ReplaySnapshot(slideB), "load", "fixture"))["applied"]!.GetValue<bool>(), "load separate replay on second slide");
    Check((await ReplayCommand(slideB, await ReplaySnapshot(slideB), "seek", time: 73))["applied"]!.GetValue<bool>(), "seek second slide to 73");
    await ReplayCall(slideA, "SelectSlide", "slide-b");
    Check((await ReplaySnapshot(slideA))["time"]!.GetValue<double>() == 73, "switch restores second slide clock");
    Check((await Edit(slideA, "undo"))["error"]!.GetValue<string>() == "nothingToUndo", "undo never affects another slide or user");
    await ReplayCall(slideA, "SelectSlide", "slide-a");
    Check((await ReplaySnapshot(slideA))["time"]!.GetValue<double>() == 37, "return restores first slide clock");
    var modified = isolated with { Color = "#123456" };
    Check((await Edit(slideA, "upsert", modified, 1))["applied"]!.GetValue<bool>(), "stroke can be changed");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "undo stroke change");
    var afterUndo = await ReplayCall(slideA, "GetState");
    Check(afterUndo["strokes"]![0]!["stroke"]!["color"]!.GetValue<string>() == isolated.Color, "undo restores previous style");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "second undo removes creation after revision rebasing");
    Check((await ReplayCall(slideA, "GetState"))["strokes"]!.AsArray().Count == 0, "multi-step undo ends at empty slide");
    Check((await ReplayCall(slideA, "GetState"))["redoCount"]!.GetValue<int>() == 2, "two undo operations expose two redo steps");
    Check((await Edit(slideA, "redo"))["applied"]!.GetValue<bool>(), "redo restores creation");
    Check((await Edit(slideA, "redo"))["applied"]!.GetValue<bool>(), "redo restores style change after revision rebasing");
    Check((await ReplayCall(slideA, "GetState"))["strokes"]![0]!["stroke"]!["color"]!.GetValue<string>() == modified.Color, "redo restores edited stroke color");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "undo a redone edit");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "undo a redone creation");
    Check((await Edit(slideA, "upsertTank", vehicle: tank with { Id = "undo-tank" }))["applied"]!.GetValue<bool>(), "tank placement on slide");
    Check((await Edit(slideA, "redo"))["error"]!.GetValue<string>() == "nothingToRedo", "fresh edit invalidates own redo branch");
    var tankState = (await ReplayCall(slideA, "GetState"))["tanks"]![0]!;
    Check((await Edit(slideA, "upsertTank", vehicle: tank with { Id = "undo-tank", Color = "#ba78ff" }, entityRevision: tankState["revision"]!.GetValue<long>()))["applied"]!.GetValue<bool>(), "placed tank can be recolored");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "undo tank color");
    Check((await ReplayCall(slideA, "GetState"))["tanks"]![0]!["tank"]!["color"]!.GetValue<string>() == tank.Color, "original tank color restored");
    Check((await Edit(slideA, "redo"))["applied"]!.GetValue<bool>(), "redo tank color");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "undo tank color again");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "tank placement undo");
    Check((await ReplayCall(slideA, "GetState"))["tanks"]!.AsArray().Count == 0, "undo removes tank");
    var shared = isolated with { Id = "shared-conflict" };
    var sharedCreated = await Edit(slideA, "upsert", shared);
    await ReplayCall(slideB, "SelectSlide", "slide-a");
    Check((await Edit(slideB, "upsert", shared with { Color = "#654321" }, sharedCreated["change"]!["revision"]!.GetValue<long>()))["applied"]!.GetValue<bool>(), "peer changes same object");
    Check((await Edit(slideA, "undo"))["error"]!.GetValue<string>() == "undoConflict", "undo protects peer edit");
    var redoStroke = shared with { Id = "redo-peer-conflict" };
    var redoCreated = await Edit(slideA, "upsert", redoStroke);
    await Edit(slideA, "upsert", redoStroke with { Color = "#ffffff" }, redoCreated["change"]!["revision"]!.GetValue<long>());
    await Edit(slideA, "undo");
    var redoRestored = (await ReplayCall(slideA, "GetState"))["strokes"]!.AsArray().First(value => value!["stroke"]!["id"]!.GetValue<string>() == redoStroke.Id)!;
    await Edit(slideB, "upsert", redoStroke with { Color = "#123456" }, redoRestored["revision"]!.GetValue<long>());
    Check((await Edit(slideA, "redo"))["error"]!.GetValue<string>() == "redoConflict", "redo protects intervening peer edit");
    await ReplayCall(slideB, "SelectSlide", "slide-b");
    Check((await ReplayCall(slideA, "UpdateScenePresence", new ScenePresenceCommand("slide-a", 1, new(10, 20, 30))))!.GetValue<bool>(), "editor cursor accepted");
    Check((await ReplayCall(slideB, "GetScenePresence")).AsArray().Count == 0, "editor cursor is isolated to its slide");
    await Workspace("present");
    var beforeRepeat = await ReplayCall(slideA, "GetWorkspace");
    await ReplayCall(slideA, "SelectSlide", "slide-a");
    Check((await ReplayCall(slideA, "GetWorkspace"))["revision"]!.GetValue<long>() == beforeRepeat["revision"]!.GetValue<long>(), "presenter selecting current slide creates no broadcast loop");
    var forced = await ReplayCall(slideB, "GetWorkspace");
    Check(forced["activeSlideId"]!.GetValue<string>() == "slide-a", "presentation forces same slide");
    Check(!(await ReplayCall(slideB, "SelectSlide", "slide-b"))["applied"]!.GetValue<bool>(), "participant cannot escape presentation");
    var cameraPose = new SceneCamera(new(10, 150, 300), new(0, 0, 0, 1), new(10, 0, 0), 60);
    await Task.Delay(50);
    Check((await ReplayCall(slideA, "UpdateScenePresence", new ScenePresenceCommand("slide-a", 2, new(15, 20, 30), cameraPose))).GetValue<bool>(), "presenter camera accepted");
    var presenceFrames = (await ReplayCall(slideB, "GetScenePresence")).AsArray();
    Check(presenceFrames.Count == 1 && presenceFrames[0]!["camera"]!["position"]!["z"]!.GetValue<double>() == 300, "participant receives presenter camera snapshot");
    Check(presenceFrames[0]!["login"]!.GetValue<string>() == "admin", "cursor identity comes from authenticated session");
    Check(!(await ReplayCall(slideA, "UpdateScenePresence", new ScenePresenceCommand("slide-a", 1, new(1, 2, 3), cameraPose))).GetValue<bool>(), "stale presence sequence rejected");
    async Task PresenceError(ClientWebSocket socket, ScenePresenceCommand command, string error) {
        var invocation = Guid.NewGuid().ToString();
        await Send(socket, new { type = 1, invocationId = invocation, target = "UpdateScenePresence", arguments = new[] { command } });
        Check((await Completion(socket, invocation))["error"]!.GetValue<string>().Contains(error), "presence rejects " + error);
    }
    await PresenceError(slideB, new("slide-a", 1, new(0, 0, 0), cameraPose), "notPresenter");
    await PresenceError(slideA, new("slide-a", 3, new(100001, 0, 0)), "invalidPresence");
    await PresenceError(slideA, new("slide-a", 3, Camera: cameraPose with { Quaternion = new(0, 0, 0, 0) }), "invalidPresence");
    await ReplayCall(slideA, "SelectSlide", "slide-b");
    Check((await ReplayCall(slideB, "GetScenePresence")).AsArray().Count == 0, "camera and cursors from previous slide cleared");
    Check((await ReplayCall(slideB, "GetState"))["slideId"]!.GetValue<string>() == "slide-b", "presenter navigation follows for everyone");
    await Workspace("stopPresentation");
    Check((await ReplayCall(slideA, "GetWorkspace"))["activeSlideId"]!.GetValue<string>() == "slide-b", "presenter remains on current slide");
    Check((await ReplayCall(slideB, "GetWorkspace"))["activeSlideId"]!.GetValue<string>() == "slide-b", "participant remains on last presented slide");
    await Workspace("add", "slide-copy", "slide-b");
    await ReplayCall(slideA, "SelectSlide", "slide-copy");
    Check((await ReplayCall(slideA, "GetState"))["strokes"]![0]!["stroke"]!["id"]!.GetValue<string>() == "point-marker", "duplicate copies tactics into separate state");
    var invalidConnection = Command("clear", 1, 0) with { SlideId = "slide-b", ConnectionId = "forged" };
    await Expect(restarted.PostAsJsonAsync("/api/sketch/commands", invalidConnection), 409);
    var savedSlides = System.Text.Json.JsonSerializer.Deserialize<WorkspaceDocument>(await File.ReadAllTextAsync(Path.Combine(directory, "workspace.json")), OnlineFiles.Json)!;
    Check(savedSlides.Slides.Count == 4, "slide metadata persisted");
    await Workspace("present");
    Check((await ReplayCall(slideB, "GetWorkspace"))["activeSlideId"]!.GetValue<string>() == "slide-copy", "participant follows another map state");
    await Workspace("stopPresentation");
    Check((await ReplayCall(slideB, "GetWorkspace"))["activeSlideId"]!.GetValue<string>() == "slide-copy", "presentation exit retains presented slide instead of old personal choice");
    var editorWorkspace = await ReplayCall(slideB, "GetWorkspace");
    Check((await ReplayCall(slideB, "WorkspaceApply", new WorkspaceCommand(Guid.NewGuid().ToString(), "present", editorWorkspace["revision"]!.GetValue<long>())))["applied"]!.GetValue<bool>(), "editor may present");
    await Expect(restarted.PutAsJsonAsync($"/api/users/{editorId}/role", new { role = "observer" }), 200);
    Check((await ReplayCall(slideA, "GetWorkspace"))["presenterId"] is null, "role revocation ends presentation");
    Check((await ReplayCall(slideB, "SelectSlide", "slide-a"))["applied"]!.GetValue<bool>(), "observer independently switches slides");
    Check((await ReplayCall(slideB, "SelectSlide", "slide-b"))["applied"]!.GetValue<bool>(), "observer can return to another slide");
    Check((await Edit(slideB, "upsert", point))["error"]!.GetValue<string>() == "forbidden", "observer cannot draw");
    Check((await ReplayCommand(slideB, await ReplaySnapshot(slideB), "seek", time: 5))["error"]!.GetValue<string>() == "forbidden", "observer cannot change replay");
    var observerWorkspace = await ReplayCall(slideB, "GetWorkspace");
    Check((await ReplayCall(slideB, "WorkspaceApply", new WorkspaceCommand(Guid.NewGuid().ToString(), "present", observerWorkspace["revision"]!.GetValue<long>())))["error"]!.GetValue<string>() == "forbidden", "observer cannot start presentation");
    await PresenceError(slideB, new("slide-b", 5, new(0, 0, 0)), "forbidden");
    Check((await Edit(slideB, "redo"))["error"]!.GetValue<string>() == "forbidden", "observer cannot redo editor actions");
    var textSign = new SketchStroke("text-sign", "#ffff00", 10, "text", "none", [new(10, 20, 30)], "Вперёд\nДержать позицию");
    var textCreated = await Edit(slideA, "upsert", textSign);
    Check(textCreated["applied"]!.GetValue<bool>(), "text sign can be placed");
    Check((await Edit(slideB, "upsert", textSign))["error"]!.GetValue<string>() == "forbidden", "observer cannot place text sign");
    Check((await Edit(slideA, "upsert", textSign with { Id = "empty-sign", Text = " " }))["error"]!.GetValue<string>() == "invalidText", "empty sign rejected");
    Check((await Edit(slideA, "upsert", textSign with { Id = "large-sign", Text = new string('a', 501) }))["error"]!.GetValue<string>() == "invalidText", "large sign rejected");
    Check((await Edit(slideA, "upsert", textSign with { Id = "bad-sign", Text = "abc\u0000def" }))["error"]!.GetValue<string>() == "invalidText", "control characters rejected");
    Check((await Edit(slideA, "remove", strokeId: textSign.Id, entityRevision: textCreated["change"]!["revision"]!.GetValue<long>()))["applied"]!.GetValue<bool>(), "eraser removes text sign");
    Check((await Edit(slideA, "undo"))["applied"]!.GetValue<bool>(), "undo restores text sign");
    Check((await ReplayCall(slideA, "GetState"))["strokes"]!.AsArray().Any(value => value!["stroke"]!["text"]?.GetValue<string>() == textSign.Text), "text and newline survive undo");
    slideA.Abort(); slideB.Abort();
    await app.StopAsync(); await app.DisposeAsync(); app = await Start();
    var finalCookies = new CookieContainer();
    using var finalClient = Client(finalCookies, app.Urls.Single());
    await Csrf(finalClient);
    await Expect(finalClient.PostAsJsonAsync("/api/auth/login", new { login = "admin", password = "admin-new-password" }), 200);
    using var finalSocket = await Socket(finalCookies, app.Urls.Single());
    Check((await ReplayCall(finalSocket, "GetWorkspace"))["slides"]!.AsArray().Count == 4, "slides survive server restart");
    await ReplayCall(finalSocket, "SelectSlide", "slide-copy");
    Check((await ReplayCall(finalSocket, "GetState"))["strokes"]![0]!["stroke"]!["style"]!.GetValue<string>() == "marker", "slide drawings survive server restart");
    Check((await ReplayCall(finalSocket, "GetState"))["strokes"]!.AsArray().Any(value => value!["stroke"]!["text"]?.GetValue<string>() == textSign.Text), "text signs survive server restart");
    Check((await ReplayCall(finalSocket, "GetScenePresence")).AsArray().Count == 0, "transient cursors/cameras never persist across server restart");
    Check((await ReplayCall(finalSocket, "GetState"))["redoCount"]!.GetValue<int>() > 0, "redo history survives server restart");
    Check((await Edit(finalSocket, "redo"))["applied"]!.GetValue<bool>(), "redo text removal after restart");
    Check(!(await ReplayCall(finalSocket, "GetState"))["strokes"]!.AsArray().Any(value => value!["stroke"]!["text"]?.GetValue<string>() == textSign.Text), "redo removes restored sign");
    Check((await Edit(finalSocket, "undo"))["applied"]!.GetValue<bool>(), "undo redone removal after restart");
    var finalWorkspace = await ReplayCall(finalSocket, "GetWorkspace");
    foreach (var slide in finalWorkspace["slides"]!.AsArray()) {
        var deletionWorkspace = await ReplayCall(finalSocket, "GetWorkspace");
        Check((await ReplayCall(finalSocket, "WorkspaceApply", new WorkspaceCommand(Guid.NewGuid().ToString(), "delete", deletionWorkspace["revision"]!.GetValue<long>(), slide!["id"]!.GetValue<string>())))["applied"]!.GetValue<bool>(), "delete slide");
    }
    Check((await ReplayCall(finalSocket, "GetState"))["mapId"] is null, "deleting last slide never resurrects legacy map");
    var emptyWorkspace = await ReplayCall(finalSocket, "GetWorkspace");
    Check(!(await ReplayCall(finalSocket, "WorkspaceApply", new WorkspaceCommand(Guid.NewGuid().ToString(), "add", emptyWorkspace["revision"]!.GetValue<long>(), "slide-copy", "another-map", "Reused")))["applied"]!.GetValue<bool>(), "deleted slide ID cannot resurrect data on another map");
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
            observed.Add(node.DeepClone());
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
