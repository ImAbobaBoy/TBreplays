using System.Globalization;
using TBReplays.Replays.Parser;

namespace TBReplays.Replays;

public static class ReplayStatisticsBuilder
{
    public static void Enrich(ReplayParseResult result, BattleResultsInfo? results, ArenaEvents arena)
    {
        result.ScoreEvents = arena.Scores;
        result.KillEvents = arena.Kills;
        var winner = results?.WinnerTeamId ?? arena.WinnerTeamId;
        var reason = results?.FinishReasonCode ?? arena.FinishReason;
        var agree = (results?.WinnerTeamId is null || arena.WinnerTeamId is null || results.WinnerTeamId == arena.WinnerTeamId)
                    && (results?.FinishReasonCode is null || arena.FinishReason is null || results.FinishReasonCode == arena.FinishReason);
        var reasonName = reason switch
        {
            1 => ("annihilation", "Уничтожение команды"),
            6 => ("supremacy", "Очки превосходства"),
            // Do not borrow unverified reason codes from PC WoT. Preserve the wire code.
            _ => ("unknown", "Причина не определена")
        };
        result.Outcome = new ReplayBattleOutcome
        {
            WinnerTeamId = winner, FinishReasonCode = reason, Reason = reasonName.Item1,
            ReasonName = reasonName.Item2, Status = winner is > 0 ? "victory" : winner == 0 ? "draw" : "unknown",
            Source = results is not null ? "battleResults" : arena.EndTime is not null ? "arenaFinish" : "unknown",
            EndTime = arena.EndTime, SourcesAgree = agree
        };
        if (!agree)
            result.Warnings = result.Warnings.Append(new ReplayParseWarning
            { Code = "outcomeSourcesDisagree", Message = "Итоги и событие завершения расходятся. Использованы итоги боя." }).ToArray();
        if (reasonName.Item1 == "unknown")
            result.Warnings = result.Warnings.Append(new ReplayParseWarning
            { Code = "unknownFinishReason", Message = "Код причины окончания сохранён, но его смысл не подтверждён." }).ToArray();

        var rawVehicles = results?.Vehicles.ToDictionary(x => x.EntityId) ?? [];
        result.BattleResultFields = MapFields(results?.RawFields ?? []);
        var extras = result.ExtraStateFrames.ToLookup(x => x.EntityId);
        var uses = result.ConsumableActivationEvents.ToLookup(x => x.EntityId);
        var shots = result.ShotEvents.ToLookup(x => x.ShooterEntityId);
        var teamByEntity = result.Vehicles.ToDictionary(x => x.EntityId, x => x.TeamId);
        var kills = arena.Kills.Where(x => IsEnemyKill(x, teamByEntity)).ToLookup(x => x.KillerEntityId!.Value);
        result.VehicleStatistics = result.Vehicles.Select(v =>
        {
            rawVehicles.TryGetValue(v.EntityId, out var raw);
            return new ReplayVehicleStatistics
            {
                EntityId = v.EntityId, TeamId = v.TeamId, Nickname = v.Nickname, VehicleName = v.VehicleName,
                AccountId = v.AccountId.ToString(CultureInfo.InvariantCulture),
                VehicleCompactDescriptor = v.VehicleCompactDescriptor, VehicleKey = v.VehicleKey,
                Nation = v.Nation, VehicleClass = v.VehicleClass, Level = v.Level,
                InitialHp = v.InitialHealth, FinalHp = v.ResultCurrentHp, IsDestroyed = v.ResultDestroyed,
                DamageDealt = raw is not null ? ArenaEventDecoder.ReadInt(raw.RawFields ?? [], 8) ?? 0 : null,
                DamageReceived = v.ResultDamageReceived, ObservedShots = shots[v.EntityId].Count(),
                ConfirmedKills = kills[v.EntityId].Count(), MinimumConsumableUses = uses[v.EntityId].Count(),
                ResultFields = MapFields(raw?.RawFields ?? []),
                Extras = extras[v.EntityId].GroupBy(x => x.ExtraId).OrderBy(x => x.Key).Select(g =>
                {
                    var first = g.First();
                    var activations = uses[v.EntityId].Where(x => x.ExtraId == g.Key).ToArray();
                    return new ReplayExtraSummary
                    {
                        ExtraId = g.Key, ItemId = first.ItemId, Key = first.Key, Name = first.Name,
                        Kind = first.Kind, Icon = first.Icon,
                        DirectUses = activations.Count(x => x.Confidence == ReplayEventConfidences.Confirmed),
                        InferredUses = activations.Count(x => x.Confidence != ReplayEventConfidences.Confirmed),
                        UsageMayBeIncomplete = first.IsConsumable
                    };
                }).ToArray()
            };
        }).ToArray();

        result.Teams = result.VehicleStatistics.GroupBy(x => x.TeamId).OrderBy(x => x.Key).Select(g =>
            new ReplayTeamStatistics
            {
                TeamId = g.Key, IsWinner = winner is null ? null : winner == g.Key,
                VehicleCount = g.Count(), AliveCount = g.All(x => x.IsDestroyed is not null) ? g.Count(x => x.IsDestroyed == false) : null,
                InitialHp = SumKnown(g.Select(x => x.InitialHp)), FinalHp = SumKnown(g.Select(x => x.FinalHp)),
                DamageDealt = SumKnown(g.Select(x => x.DamageDealt)), DamageReceived = SumKnown(g.Select(x => x.DamageReceived)),
                ConfirmedKills = g.Sum(x => x.ConfirmedKills),
                FinalSupremacyPoints = arena.Scores.LastOrDefault(x => x.TeamId == g.Key)?.Points
            }).ToArray();
        result.Playback = BuildPlayback(result);
    }

    private static IReadOnlyList<ReplayResultField> MapFields(IReadOnlyList<ProtoField> fields) => fields.Select(x =>
        new ReplayResultField(x.FieldNumber, (int)x.WireType,
            x.VarintValue?.ToString(CultureInfo.InvariantCulture),
            x.WireType == ProtoWireType.Varint ? null : Convert.ToBase64String(x.BytesValue))).ToArray();

    private static int? SumKnown(IEnumerable<int?> source)
    {
        var values = source.ToArray();
        return values.Any(x => x is null) ? null : values.Sum(x => x!.Value);
    }

    private static ReplayPlaybackData BuildPlayback(ReplayParseResult result)
    {
        var endTime = Math.Max(result.Outcome.EndTime ?? 0, (float)(result.BattleDuration ?? 0));
        endTime = Math.Max(endTime, result.MovementFrames.Select(x => x.Time).DefaultIfEmpty().Max());
        var movements = result.MovementFrames.ToLookup(x => x.EntityId);
        var turrets = result.TurretFrames.ToLookup(x => x.EntityId);
        var health = result.HealthFrames.ToLookup(x => x.EntityId);
        var extras = result.ExtraStateFrames.ToLookup(x => x.EntityId);
        var modules = result.ModuleStateEvents.ToLookup(x => x.EntityId);
        var intervals = result.VisibilityIntervals.ToLookup(x => x.EntityId);
        var uses = result.ConsumableActivationEvents.ToLookup(x => x.EntityId);
        var shots = result.ShotEvents.ToLookup(x => x.ShooterEntityId);
        var death = result.DeathEvents.ToDictionary(x => x.EntityId);
        var teamByEntity = result.Vehicles.ToDictionary(x => x.EntityId, x => x.TeamId);
        var kills = result.KillEvents.Where(x => IsEnemyKill(x, teamByEntity)).ToLookup(x => x.KillerEntityId!.Value);
        var tracks = new List<ReplayVehicleTrack>();
        foreach (var vehicle in result.Vehicles)
        {
            var id = vehicle.EntityId;
            var healthFrames = health[id].OrderBy(x => x.Time).ThenBy(x => x.PacketIndex).ToArray();
            var extraFrames = extras[id].OrderBy(x => x.Time).ThenBy(x => x.PacketIndex).ToArray();
            var moduleFrames = modules[id].OrderBy(x => x.Time).ToArray();
            var visible = intervals[id].ToArray();
            death.TryGetValue(id, out var died);
            var times = new SortedSet<float> { 0, endTime };
            foreach (var frame in healthFrames) times.Add(frame.Time);
            foreach (var frame in extraFrames) times.Add(frame.Time);
            foreach (var frame in moduleFrames) times.Add(frame.Time);
            foreach (var interval in visible)
            {
                times.Add(interval.StartTime);
                if (interval.EndTime is not null) times.Add(interval.EndTime.Value);
            }
            foreach (var kill in kills[id]) times.Add(kill.Time);
            if (died is not null) times.Add(died.Time);
            if (result.Outcome.EndTime is not null) times.Add(result.Outcome.EndTime.Value);
            // Expirations get their own server state, so the UI need not interpret consumable timers.
            foreach (var frame in extraFrames.Where(x => x.StateEndTime > x.Time && x.StateEndTime <= endTime))
                times.Add(frame.StateEndTime!.Value);

            var states = new List<ReplayVehicleState>();
            var currentHp = vehicle.InitialHealth;
            var observedDamage = 0;
            var healthIndex = 0;
            var extraIndex = 0;
            var moduleIndex = 0;
            var currentExtras = new Dictionary<int, ReplayExtraStateFrame>();
            var currentModules = new Dictionary<int, ReplayModuleStateEvent>();
            foreach (var time in times)
            {
                while (healthIndex < healthFrames.Length && healthFrames[healthIndex].Time <= time)
                {
                    var next = healthFrames[healthIndex++].Health;
                    if (currentHp is not null) observedDamage += Math.Max(0, currentHp.Value - next);
                    currentHp = next;
                }
                while (extraIndex < extraFrames.Length && extraFrames[extraIndex].Time <= time)
                {
                    var frame = extraFrames[extraIndex++];
                    currentExtras[frame.ExtraId] = frame;
                }
                while (moduleIndex < moduleFrames.Length && moduleFrames[moduleIndex].Time <= time)
                {
                    var frame = moduleFrames[moduleIndex++];
                    currentModules[frame.ModuleId] = frame;
                }
                var alive = died is null || time < died.Time;
                var isFinal = result.Outcome.EndTime is not null && time >= result.Outcome.EndTime;
                if (isFinal && vehicle.ResultCurrentHp is not null) currentHp = vehicle.ResultCurrentHp;
                if (!alive) currentHp = 0;
                var isVisible = alive && visible.Any(x => time >= x.StartTime && (x.EndTime is null || time < x.EndTime));
                var displayExtras = currentExtras.Values.Select(x => ProjectExtra(x, time, alive)).OrderBy(x => x.ExtraId).ToArray();
                states.Add(new ReplayVehicleState
                {
                    Time = time, Health = currentHp,
                    HealthFraction = currentHp is not null && vehicle.InitialHealth is > 0
                        ? Math.Clamp((double)currentHp.Value / vehicle.InitialHealth.Value, 0, 1) : null,
                    IsAlive = alive, IsVisible = isVisible,
                    HealthIsLastKnown = alive && !isVisible && !isFinal && time > 0,
                    ObservedDamageReceived = observedDamage, ConfirmedKills = kills[id].Count(x => x.Time <= time),
                    Extras = displayExtras, Modules = currentModules.Values.OrderBy(x => x.ModuleId).ToArray()
                });
            }
            tracks.Add(new ReplayVehicleTrack
            {
                EntityId = id, TeamId = vehicle.TeamId, Nickname = vehicle.Nickname, VehicleName = vehicle.VehicleName,
                MaxHp = vehicle.InitialHealth, Movement = movements[id].ToArray(), Turret = turrets[id].ToArray(),
                States = states, Visibility = visible, ConsumableUses = uses[id].ToArray(), Shots = shots[id].ToArray()
            });
        }

        // Merge simultaneous packet updates before publishing a scoreboard snapshot.
        var stateChanges = tracks.SelectMany(track => track.States.Select(state => (track, state))).ToLookup(x => x.state.Time);
        var scores = result.ScoreEvents.ToLookup(x => x.Time);
        var scoreboardTimes = stateChanges.Select(x => x.Key).Concat(scores.Select(x => x.Key)).Distinct().Order();
        var latestStates = new Dictionary<uint, ReplayVehicleState>();
        var latestScores = new Dictionary<int, int>();
        var scoreboard = new List<ReplayScoreboardFrame>();
        foreach (var time in scoreboardTimes)
        {
            foreach (var change in stateChanges[time]) latestStates[change.track.EntityId] = change.state;
            foreach (var score in scores[time].OrderBy(x => x.PacketIndex)) latestScores[score.TeamId] = score.Points;
            var teams = tracks.GroupBy(x => x.TeamId).OrderBy(x => x.Key).Select(g =>
            {
                var teamStates = g.Select(x => latestStates.GetValueOrDefault(x.EntityId)).ToArray();
                return new ReplayTeamState(g.Key, teamStates.Count(x => x?.IsAlive == true),
                    teamStates.Sum(x => x?.ConfirmedKills ?? 0), SumKnown(g.Select(x => x.MaxHp)),
                    SumKnown(teamStates.Select(x => x?.Health)), teamStates.Any(x => x is null || x.HealthIsLastKnown),
                    latestScores.TryGetValue(g.Key, out var points) ? points : null);
            }).ToArray();
            if (scoreboard.Count == 0 || !scoreboard[^1].Teams.SequenceEqual(teams))
                scoreboard.Add(new ReplayScoreboardFrame(time, teams));
        }
        return new ReplayPlaybackData
        {
            StartTime = 0, EndTime = endTime, Vehicles = tracks, Scoreboard = scoreboard,
            Projectiles = result.ProjectilePoints.GroupBy(x => x.ProjectileId)
                .Select(x => new ReplayProjectileTrack(x.Key, x.OrderBy(y => y.Time).ToArray())).ToArray()
        };
    }

    private static bool IsEnemyKill(ReplayKillEvent kill, IReadOnlyDictionary<uint, int> teams) =>
        kill.KillerEntityId is not null && teams.TryGetValue(kill.KillerEntityId.Value, out var killerTeam)
        && teams.TryGetValue(kill.VictimEntityId, out var victimTeam) && killerTeam != victimTeam;

    private static ReplayExtraStateFrame ProjectExtra(ReplayExtraStateFrame source, float time, bool alive)
    {
        if (!alive) return source with { State = ReplayExtraStateNames.Cleanup, StateCode = 255 };
        if (source.StateEndTime is null || time < source.StateEndTime) return source;
        // A hidden tank may reactivate after a cooldown; ready is only the last-known state.
        return source.StateCode switch
        {
            2 => source with { State = "UnknownAfterActivation", StateCode = 0, Confidence = ReplayEventConfidences.Inferred },
            3 => source with { State = ReplayExtraStateNames.Installed, StateCode = 1, Confidence = ReplayEventConfidences.Inferred },
            _ => source
        };
    }
}
