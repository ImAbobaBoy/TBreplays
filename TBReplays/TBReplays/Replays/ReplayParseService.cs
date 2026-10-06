using TBReplays.ClientGameData;
using TBReplays.Replays.Parser;

namespace TBReplays.Replays;

public sealed class ReplayParseService
{
    public ReplayParseResult Parse(
        Stream replayStream,
        ClientGameDataCatalog catalog)
    {
        var archive = TbreplayArchiveReader.Read(replayStream);

        return Parse(archive, catalog);
    }

    private static ReplayParseResult Parse(
        TbreplayArchive archive,
        ClientGameDataCatalog catalog)
    {
        var metaInfo = ReplayMetaJsonReader.Read(archive.MetaJson);
        var replayData = ReplayDataParser.Parse(archive.DataReplayBytes);

        var packets = ReplayPacketParser.ParsePackets(
            archive.DataReplayBytes,
            replayData.Header.PacketStartOffset);

        var battleResults = BattleResultsParser.TryParse(archive.BattleResultsBytes)
                            ?? BattleResultsParser.TryParsePackets(packets);

        var vehicles = battleResults?.Vehicles
            .Select(x => ToReplayVehicleInfo(x, catalog))
            .OrderBy(x => x.TeamId)
            .ThenBy(x => x.EntityId)
            .ToArray()
            ?? [];

        var vehiclesByEntityId = vehicles.ToDictionary(x => x.EntityId, x => x);

        var extraIdWidth = replayData.Header.ClientVersion.StartsWith("26.4.", StringComparison.Ordinal) ? 1 : 2;
        var snapshots = packets.Select(p => VehicleSnapshotDecoder.TryDecode(p, extraIdWidth)).OfType<VehicleSnapshot>()
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId)).ToArray();
        var arena = ArenaEventDecoder.Decode(packets, vehiclesByEntityId.Keys.ToHashSet());
        var movementFrames = BuildMovementFrames(packets, vehiclesByEntityId);
        var turretFrames = BuildTurretFrames(packets, vehiclesByEntityId);
        var shotEvents = BuildShotEvents(packets, vehiclesByEntityId,
            replayData.Header.ClientVersion.StartsWith("26.10.", StringComparison.Ordinal) ? 45 : 37);

        var projectileIdsFromShots = shotEvents
            .Select(x => x.ProjectileId)
            .ToHashSet();

        var projectilePoints = BuildProjectilePoints(packets, projectileIdsFromShots);
        var healthFrames = BuildHealthFrames(packets, vehiclesByEntityId, snapshots);
        var vehiclesWithEffectiveHp = BuildVehicleEffectiveHp(vehicles, healthFrames, snapshots);
        var visibilityFrames = BuildVisibilityFrames(packets, vehiclesByEntityId);
        var extraStateFrames = BuildExtraStateFrames(packets, vehiclesByEntityId, catalog, snapshots, extraIdWidth);
        // The old compact marker profile is not valid for two-byte extra IDs.
        var moduleCompactMarkers = extraIdWidth == 1 ? BuildModuleCompactMarkers(packets, vehiclesByEntityId, catalog) : [];
        var moduleStateEvents = BuildModuleStateEvents(packets, moduleCompactMarkers, vehiclesByEntityId, catalog, extraIdWidth);
        var moduleHitSummaryEvents = BuildModuleHitSummaryEvents(packets, vehiclesByEntityId, catalog, extraIdWidth);
        var reloadEvents = packets.SelectMany(p => ReloadPacketDecoder.Decode(p, replayData.Header.ClientVersion))
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId)).OrderBy(x => x.Time).ThenBy(x => x.PacketIndex).ToArray();
        var consumableActivationEvents = BuildConsumableActivationEvents(extraStateFrames, moduleStateEvents);
        var damageEvents = BuildDamageEvents(healthFrames);
        var deathEvents = BuildDeathEvents(
            damageEvents,
            vehiclesWithEffectiveHp,
            movementFrames, arena);
        var battleDuration = metaInfo.BattleDuration
                             ?? CalculateBattleDuration(
                                 movementFrames,
                                 turretFrames,
                                 shotEvents,
                                 projectilePoints,
                                 healthFrames,
                                 visibilityFrames,
                                 extraStateFrames,
                                 consumableActivationEvents,
                                 moduleStateEvents,
                                 moduleHitSummaryEvents,
                                 moduleCompactMarkers);
        var visibilityIntervals = BuildMovementBasedVisibilityIntervals(
            movementFrames,
            deathEvents,
            battleDuration);
        var warnings = BuildParseWarnings(
            archive,
            metaInfo,
            battleResults,
            vehiclesWithEffectiveHp,
            movementFrames,
            visibilityFrames,
            healthFrames);

        var recorderTeamId = vehicles.FirstOrDefault(x => x.AccountId == metaInfo.RecorderAccountId)?.TeamId;
        var result = new ReplayParseResult
        {
            VehicleStateProtocolVersion = 1,
            ReloadEvents = reloadEvents,
            ShotProtocolVersion = 1,
            RecorderEntityId = vehicles.FirstOrDefault(x => x.AccountId == metaInfo.RecorderAccountId)?.EntityId,
            RecorderTeamId = recorderTeamId,
            SchemaVersion = 2,
            CapturePointProtocolVersion = replayData.Header.ClientVersion.StartsWith("26.10.", StringComparison.Ordinal) ? 1 : 0,
            CapturePointEvents = CapturePointPacketDecoder.Decode(packets, vehiclesByEntityId.Keys.ToHashSet(), replayData.Header.ClientVersion),
            SpottingCandidates = SpottingCandidateDecoder.Decode(packets,
                vehicles.Where(v => v.TeamId == recorderTeamId).Select(v => v.EntityId).ToHashSet(), replayData.Header.ClientVersion),
            CatalogVersion = catalog.Version,
            ArenaUniqueId = battleResults?.ArenaUniqueId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ClientVersion = replayData.Header.ClientVersion,
            ClientHash = replayData.Header.ClientHash,
            MapName = metaInfo.MapName,
            MapId = metaInfo.MapId,
            BattleDuration = battleDuration,
            Vehicles = vehiclesWithEffectiveHp,
            MovementFrames = movementFrames,
            TurretFrames = turretFrames,
            ShotEvents = shotEvents,
            ProjectilePoints = projectilePoints,
            HealthFrames = healthFrames,
            VisibilityFrames = visibilityFrames,
            VisibilityIntervals = visibilityIntervals,
            DamageEvents = damageEvents,
            DeathEvents = deathEvents,
            ExtraStateFrames = extraStateFrames,
            ConsumableActivationEvents = consumableActivationEvents,
            ModuleStateEvents = moduleStateEvents,
            ModuleHitSummaryEvents = moduleHitSummaryEvents,
            ModuleCompactMarkers = moduleCompactMarkers,
            Warnings = warnings
        };

        ReplayStatisticsBuilder.Enrich(result, battleResults, arena);
        var additionalWarnings = result.Warnings.ToList();
        if (!result.ClientVersion!.StartsWith("26.4.", StringComparison.Ordinal) && !result.ClientVersion.StartsWith("26.8.", StringComparison.Ordinal))
            additionalWarnings.Add(CreateWarning("unverifiedProtocolVersion", "Версия протокола не проверена на образцах. Использован профиль extras с 16-битным ID; непрочитанные данные не подменяются догадками."));
        if (!string.Equals(result.ClientVersion, catalog.Version, StringComparison.OrdinalIgnoreCase))
            additionalWarnings.Add(CreateWarning("catalogVersionMismatch", $"Версия реплея {result.ClientVersion}, справочников {catalog.Version}. Названия сопоставлены по доступному каталогу; HP и таймеры взяты из реплея."));
        foreach (var vehicle in vehiclesWithEffectiveHp)
        {
            var original = vehiclesByEntityId[vehicle.EntityId];
            if (vehicle.EffectiveHpSource == ReplayVehicleHealthSources.EntitySnapshot && original.EffectiveHp is not null && original.EffectiveHp != vehicle.EffectiveHp)
                additionalWarnings.Add(CreateWarning("hpSourcesDisagree", "HP в снимке танка расходится с суммой итоговых HP и урона; использован снимок.", vehicle.EntityId));
            if (!snapshots.Any(x => x.EntityId == vehicle.EntityId))
                additionalWarnings.Add(CreateWarning("vehicleSnapshotUnavailable", "Снимок танка не прочитан: начальное HP определено по итогам, состав снаряжения может быть неполным.", vehicle.EntityId));
        }
        result.Warnings = additionalWarnings;
        result.TimelineSummary = BuildTimelineSummary(result);

        return result;
    }

    private static ReplayVehicleInfo ToReplayVehicleInfo(
        VehicleBattleInfo source,
        ClientGameDataCatalog catalog)
    {
        var descriptor = source.VehicleCompactDescriptor <= int.MaxValue
            ? (int)source.VehicleCompactDescriptor
            : unchecked((int)source.VehicleCompactDescriptor);

        catalog.VehiclesByDescriptor.TryGetValue(descriptor, out var vehicleDefinition);

        return new ReplayVehicleInfo
        {
            EntityId = source.EntityId,
            AccountId = ToSignedAccountId(source.AccountId),
            Nickname = source.Nickname,
            TeamId = source.TeamId,
            VehicleCompactDescriptor = source.VehicleCompactDescriptor,
            VehicleKey = vehicleDefinition?.Key,
            VehicleName = vehicleDefinition?.DisplayName,
            Nation = vehicleDefinition?.Nation,
            VehicleClass = vehicleDefinition?.Tags?.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault(x => x is "lightTank" or "mediumTank" or "heavyTank" or "AT-SPG" or "SPG"),
            Level = vehicleDefinition?.Level,
            BaseHullHp = CalculateBaseHp(vehicleDefinition),
            EffectiveHp = source.EffectiveHp,
            ResultCurrentHp = source.CurrentHp,
            ResultDamageReceived = source.DamageReceived,
            ResultDestroyed = source.IsDestroyed,
            EffectiveHpSource = source.EffectiveHp is null
                ? ReplayVehicleHealthSources.None
                : ReplayVehicleHealthSources.BattleResults,
            EffectiveHpDeltaFromBase = CalculateEffectiveHpDelta(CalculateBaseHp(vehicleDefinition), source.EffectiveHp),
            EffectiveHpRatioToBase = CalculateEffectiveHpRatio(CalculateBaseHp(vehicleDefinition), source.EffectiveHp)
        };
    }

    private static int? CalculateBaseHp(VehicleDefinition? vehicleDefinition)
    {
        if (vehicleDefinition?.HullHp is null)
        {
            return null;
        }

        // TODO TBREPLAYS-LOADOUT:
        // battle_results.dat currently gives only vehicle compact descriptor here, not the full
        // vehicleRawU16 module layout. Until selected turret id is decoded from the replay roster,
        // use the highest turret HP as the best available base HP approximation. This is correct
        // for most high-tier vehicles with a single battle turret, but must be replaced with
        // hull HP + selected turret HP when vehicleRawU16 is available in the backend parser.
        var turretHp = vehicleDefinition.TurretsById.Values
            .Select(x => x.MaxHealth)
            .Where(x => x is not null)
            .DefaultIfEmpty(0)
            .Max() ?? 0;

        return vehicleDefinition.HullHp.Value + turretHp;
    }

    private static int? CalculateEffectiveHpDelta(int? baseHp, int? effectiveHp)
    {
        if (baseHp is null || effectiveHp is null)
        {
            return null;
        }

        return effectiveHp.Value - baseHp.Value;
    }

    private static double? CalculateEffectiveHpRatio(int? baseHp, int? effectiveHp)
    {
        if (baseHp is null || baseHp.Value <= 0 || effectiveHp is null)
        {
            return null;
        }

        return Math.Round((double)effectiveHp.Value / baseHp.Value, 4, MidpointRounding.AwayFromZero);
    }

    private static IReadOnlyList<ReplayMovementFrame> BuildMovementFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        var movementFrames = packets
            .Select(MovementPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .ToArray();

        var result = new List<ReplayMovementFrame>(movementFrames.Length);

        foreach (var group in movementFrames
                     .GroupBy(x => x.EntityId)
                     .OrderBy(x => x.Key))
        {
            var vehicle = vehiclesByEntityId[group.Key];

            var ordered = group
                .OrderBy(x => x.ClockSeconds)
                .ThenBy(x => x.PacketIndex)
                .ToArray();

            var segmentIndex = 0;
            MovementFrame? previous = null;

            foreach (var current in ordered)
            {
                if (previous is not null && ShouldStartNewSegment(previous, current))
                {
                    segmentIndex++;
                }

                result.Add(new ReplayMovementFrame
                {
                    Time = current.ClockSeconds,
                    EntityId = current.EntityId,
                    TeamId = vehicle.TeamId,
                    SegmentIndex = segmentIndex,

                    X = current.X,
                    Y = current.Y,
                    Z = current.Z,

                    YawRadians = current.YawRadians,
                    PitchRadians = current.PitchRadians,
                    RollRadians = current.RollRadians,

                    IsVolatile = current.IsVolatile
                });

                previous = current;
            }
        }

        return result
            .OrderBy(x => x.Time)
            .ThenBy(x => x.TeamId)
            .ThenBy(x => x.EntityId)
            .ThenBy(x => x.SegmentIndex)
            .ToArray();
    }

    private static IReadOnlyList<ReplayTurretFrame> BuildTurretFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(PropertyPacketDecoder.TryDecodeTurretYaw)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => new ReplayTurretFrame
            {
                Time = x.ClockSeconds,
                EntityId = x.EntityId,
                TurretYawRadians = x.TurretYawRadians
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayShotEvent> BuildShotEvents(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId,
        int shotPayloadLength)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(EntityMethodPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .Select(method => EntityMethodPacketDecoder.TryDecodeShotFired(method, shotPayloadLength))
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.ShooterEntityId))
            .Select(x => new ReplayShotEvent
            {
                PacketIndex = x.PacketIndex,
                PacketOffset = x.PacketOffset,
                Time = x.ClockSeconds,
                ShooterEntityId = x.ShooterEntityId,
                ProjectileId = x.ProjectileId,
                ShotFlags = x.ShotFlags,

                OriginX = x.OriginX,
                OriginY = x.OriginY,
                OriginZ = x.OriginZ,

                DirectionX = x.DirectionOrVelocityX,
                DirectionY = x.DirectionOrVelocityY,
                DirectionZ = x.DirectionOrVelocityZ
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.ShooterEntityId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayProjectilePoint> BuildProjectilePoints(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlySet<uint> projectileIdsFromShots)
    {
        if (projectileIdsFromShots.Count == 0)
        {
            return [];
        }

        return packets
            .Select(EntityMethodPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .Select(EntityMethodPacketDecoder.TryDecodeProjectilePoint)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => projectileIdsFromShots.Contains(x.ProjectileId))
            .Select(x => new ReplayProjectilePoint
            {
                Time = x.ClockSeconds,
                ProjectileId = x.ProjectileId,

                X = x.X,
                Y = x.Y,
                Z = x.Z
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.ProjectileId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayHealthFrame> BuildHealthFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId,
        IReadOnlyList<VehicleSnapshot> snapshots)
    {
        if (vehiclesByEntityId.Count == 0) return [];
        return packets
            .Select(PropertyPacketDecoder.TryDecodeHealth)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => new ReplayHealthFrame
            {
                Time = x.ClockSeconds,
                EntityId = x.EntityId,
                Health = Math.Max(0, (int)x.Health),
                PacketIndex = x.PacketIndex
            })
            .Concat(snapshots.Select(x => new ReplayHealthFrame
            { Time = x.Time, EntityId = x.EntityId, Health = x.Health, PacketIndex = x.PacketIndex, Source = "entitySnapshot" }))
            .OrderBy(x => x.Time)
            .ThenBy(x => x.PacketIndex)
            .ToArray();
    }

    private static IReadOnlyList<ReplayVehicleInfo> BuildVehicleEffectiveHp(
        IReadOnlyList<ReplayVehicleInfo> vehicles,
        IReadOnlyList<ReplayHealthFrame> healthFrames,
        IReadOnlyList<VehicleSnapshot> snapshots)
    {
        if (vehicles.Count == 0)
        {
            return vehicles;
        }

        var healthFramesByEntityId = healthFrames
            .GroupBy(x => x.EntityId)
            .ToDictionary(
                x => x.Key,
                x => x
                    .OrderBy(y => y.Time)
                    .ThenByDescending(y => y.Health)
                    .ToArray());

        return vehicles
            .Select(vehicle => EnrichVehicleWithEffectiveHp(vehicle, healthFramesByEntityId, snapshots.FirstOrDefault(x => x.EntityId == vehicle.EntityId)))
            .ToArray();
    }

    private static ReplayVehicleInfo EnrichVehicleWithEffectiveHp(
        ReplayVehicleInfo vehicle,
        IReadOnlyDictionary<uint, ReplayHealthFrame[]> healthFramesByEntityId, VehicleSnapshot? snapshot)
    {
        var hasFrames = healthFramesByEntityId.TryGetValue(vehicle.EntityId, out var frames) && frames.Length > 0;
        var initialFrame = hasFrames ? frames![0] : null;
        var maxObservedHealth = hasFrames ? frames!.Max(x => x.Health) : (int?)null;
        var (effectiveHp, effectiveHpSource) = snapshot is not null
            ? ((int?)snapshot.MaxHealth, ReplayVehicleHealthSources.EntitySnapshot)
            : ResolveEffectiveHp(vehicle, maxObservedHealth);
        var exact = effectiveHpSource is ReplayVehicleHealthSources.EntitySnapshot or ReplayVehicleHealthSources.BattleResults;

        return new ReplayVehicleInfo
        {
            EntityId = vehicle.EntityId,
            AccountId = vehicle.AccountId,
            Nickname = vehicle.Nickname,
            TeamId = vehicle.TeamId,
            VehicleCompactDescriptor = vehicle.VehicleCompactDescriptor,
            VehicleKey = vehicle.VehicleKey,
            VehicleName = vehicle.VehicleName,
            Nation = vehicle.Nation,
            VehicleClass = vehicle.VehicleClass,
            Level = vehicle.Level,
            BaseHullHp = vehicle.BaseHullHp,
            InitialHealth = exact ? effectiveHp : null,
            InitialHealthIsExact = exact,
            InitialHealthTime = exact ? 0 : null,
            FirstObservedHealth = initialFrame?.Health,
            FirstObservedHealthTime = initialFrame?.Time,
            MaxObservedHealth = maxObservedHealth is null
                ? vehicle.MaxObservedHealth
                : Math.Max(vehicle.MaxObservedHealth ?? 0, maxObservedHealth.Value),
            EffectiveHp = effectiveHp,
            ResultCurrentHp = vehicle.ResultCurrentHp,
            ResultDamageReceived = vehicle.ResultDamageReceived,
            ResultDestroyed = vehicle.ResultDestroyed,
            EffectiveHpSource = effectiveHpSource,
            EffectiveHpDeltaFromBase = CalculateEffectiveHpDelta(vehicle.BaseHullHp, effectiveHp),
            EffectiveHpRatioToBase = CalculateEffectiveHpRatio(vehicle.BaseHullHp, effectiveHp)
        };
    }

    private static (int? EffectiveHp, string Source) ResolveEffectiveHp(
        ReplayVehicleInfo vehicle,
        int? maxObservedHealth)
    {
        if (vehicle.EffectiveHp is not null)
        {
            return (vehicle.EffectiveHp, vehicle.EffectiveHpSource);
        }

        return (null, ReplayVehicleHealthSources.None);
    }

    private static readonly HashSet<int> KnownConsumableExtraIds =
    [
        9,
        10,
        11,
        12,
        13,
        61,
        62,
        66
    ];

    private static readonly HashSet<int> KnownNonConsumableExtraIds =
    [
        14,
        15,
        16,
        17,
        19,
        20,
        22,
        24,
        29,
        30,
        69,
        74,
        75,
        107,
        224
    ];

    private static readonly Dictionary<int, (string Key, string Name, string Category)> KnownExtraFallbacks = new()
    {
        [9] = ("berserk", "Адреналин", "consumable"),
        [10] = ("afterburning", "Форсаж", "consumable"),
        [11] = ("largeRecoverkit", "Универсальный восстановительный комплект", "consumable"),
        [12] = ("largeMedkit", "Аптечка", "consumable"),
        [13] = ("largeRepairkit", "Ремкомплект", "consumable"),
        [14] = ("chocolate", "Шоколад", "provision"),
        [15] = ("cocacola", "Ящик колы", "provision"),
        [16] = ("ration", "Доппаёк", "provision"),
        [17] = ("ration_uk", "Пудинг с чаем", "provision"),
        [19] = ("ration_china", "Утка по-пекински", "provision"),
        [20] = ("hot_coffee", "Кофе с круассаном", "provision"),
        [22] = ("cocacola_can", "Бутылка колы", "provision"),
        [24] = ("black_tea", "Чёрный чай", "provision"),
        [29] = ("improved_fuel", "Улучшенное топливо", "provision"),
        [30] = ("safety_set", "Защитный набор", "provision"),
        [61] = ("improvedAfterburning", "Улучшенный форсаж", "consumable"),
        [62] = ("fireControlSystem", "Калибровка прицела", "consumable"),
        [66] = ("shieldKit", "Динамическая защита", "consumable"),
        [69] = ("largeHPStock", "Усиленная навесная защита", "passive"),
        [74] = ("ration_czech_hq", "Колач", "provision"),
        [75] = ("ration_czech_regular", "Жареный сыр", "provision"),
        [107] = ("improvedGearOil", "Улучшенное масло", "provision"),
        [224] = ("doubleBarrelGunSwitcher", "Переключение двухорудийной механики", "vehicleMechanic")
    };

    private static readonly Dictionary<int, (string Key, string Name)> KnownModuleFallbacks = new()
    {
        [31] = ("engineHealth", "Двигатель"),
        [32] = ("ammoBayHealth", "Боеукладка"),
        [33] = ("fuelTankHealth", "Топливный бак"),
        [34] = ("leftTrackHealth", "Левая гусеница"),
        [35] = ("rightTrackHealth", "Правая гусеница"),
        [36] = ("gunHealth", "Орудие"),
        [37] = ("turretRotatorHealth", "Механизм поворота башни"),
        [38] = ("surveyingDeviceHealth", "Приборы наблюдения"),
        [39] = ("commanderHealth", "Командир"),
        [40] = ("driverHealth", "Механик-водитель"),
        [41] = ("gunner1Health", "Наводчик 1"),
        [42] = ("gunner2Health", "Наводчик 2"),
        [43] = ("loader1Health", "Заряжающий 1"),
        [44] = ("loader2Health", "Заряжающий 2")
    };

    private static IReadOnlyList<ReplayExtraStateFrame> BuildExtraStateFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId,
        ClientGameDataCatalog catalog, IReadOnlyList<VehicleSnapshot> snapshots, int extraIdWidth)
    {
        if (vehiclesByEntityId.Count == 0) return [];
        var direct = packets.Select(p => ExtraEffectPacketDecoder.TryDecodeExtraState(p, extraIdWidth)).OfType<ExtraEffectStateFrame>().ToArray();
        var offsets = direct.Where(x => x.StateCode == 2 && x.TimerStamp > 0).Select(x => x.TimerStamp - x.ClockSeconds).Order().ToArray();
        var clockOffset = offsets.Length == 0 ? (double?)null : offsets[offsets.Length / 2];
        return direct.Concat(snapshots.SelectMany(x => x.Extras))
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => ToReplayExtraStateFrame(x, catalog, clockOffset))
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ThenBy(x => x.ExtraId)
            .ToArray();
    }

    private static ReplayExtraStateFrame ToReplayExtraStateFrame(
        ExtraEffectStateFrame source,
        ClientGameDataCatalog catalog, double? clockOffset)
    {
        var extra = ResolveExtra(source.ExtraId, catalog);
        catalog.ExtrasByRuntimeId.TryGetValue(source.ExtraId, out var definition);
        var isConsumable = definition is not null
            ? definition.IsConsumable && !KnownNonConsumableExtraIds.Contains(source.ExtraId)
            : IsConsumableExtra(source.ExtraId, extra.Category, extra.SourceKind);
        var kind = definition?.IsAbility == true ? "vehicleMechanic" : isConsumable ? "consumable"
            : extra.SourceKind == "provision" ? "provision"
            : extra.SourceKind is "unknown" or "runtimeExtra" ? "unknown" : "passive";
        var start = clockOffset is not null && source.TimerStamp > 0
            ? (float?)(source.TimerStamp - clockOffset.Value) : null;
        var isTimelineActivation = source.StateCode == 2 && isConsumable;

        return new ReplayExtraStateFrame
        {
            PacketIndex = source.PacketIndex,
            IsSnapshot = source.IsSnapshot,
            TimerStamp = source.TimerStamp,
            Duration = source.Duration,
            StateStartTime = start,
            StateEndTime = start is not null && source.Duration >= 0 ? start + source.Duration : null,
            ItemId = definition?.Id,
            Icon = definition?.Icon,
            Kind = kind,
            Time = source.ClockSeconds,
            EntityId = source.EntityId,
            ExtraId = source.ExtraId,
            Key = extra.Key,
            Name = extra.Name,
            Category = extra.Category,
            SourceKind = extra.SourceKind,
            StateCode = source.StateCode,
            State = ResolveExtraState(source.StateCode),
            IsConsumable = isConsumable,
            IsTimelineActivation = isTimelineActivation,
            Confidence = ReplayEventConfidences.Confirmed
        };
    }

    private static IReadOnlyList<ReplayModuleCompactMarker> BuildModuleCompactMarkers(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId,
        ClientGameDataCatalog catalog)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(ModulePacketDecoder.TryDecodeCompactModuleMarker)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x =>
            {
                var module = ResolveModule(x.ModuleId, catalog);

                return new ReplayModuleCompactMarker
                {
                    Time = x.ClockSeconds,
                    EntityId = x.EntityId,
                    ModuleId = x.ModuleId,
                    ModuleKey = module.Key,
                    ModuleName = module.Name,
                    Marker = x.Marker,
                    Meaning = ResolveCompactModuleMarkerMeaning(x.Marker),
                    Confidence = x.Marker is 0xa4 or 0xa8
                        ? ReplayEventConfidences.Confirmed
                        : ReplayEventConfidences.Experimental
                };
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ThenBy(x => x.ModuleId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayModuleStateEvent> BuildModuleStateEvents(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyList<ReplayModuleCompactMarker> compactMarkers,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId,
        ClientGameDataCatalog catalog, int idWidth)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        var fromType20 = packets
            .Select(EntityMethodPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .Select(x => ModulePacketDecoder.TryDecodeModuleState(x, idWidth))
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => ToReplayModuleStateEvent(x, catalog))
            .Where(x => x is not null)
            .Select(x => x!);

        var fromCompactMarkers = compactMarkers
            .Where(x => x.Marker is 0xa4 or 0xa8)
            .Select(x => new ReplayModuleStateEvent
            {
                Time = x.Time,
                EntityId = x.EntityId,
                ModuleId = x.ModuleId,
                ModuleKey = x.ModuleKey,
                ModuleName = x.ModuleName,
                StateCode = x.Marker,
                State = x.Marker == 0xa4
                    ? ReplayModuleStateNames.Damaged
                    : ReplayModuleStateNames.Destroyed,
                SourceEntityId = null,
                Source = ReplayModuleEventSources.Channel32CompactMarker,
                Confidence = ReplayEventConfidences.Confirmed
            });

        return fromType20
            .Concat(fromCompactMarkers)
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ThenBy(x => x.ModuleId)
            .ToArray();
    }

    private static ReplayModuleStateEvent? ToReplayModuleStateEvent(
        ModuleStateCandidateFrame source,
        ClientGameDataCatalog catalog)
    {
        var state = ResolveType20ModuleState(source.StateCode);
        if (source.ModuleId == 0) return null;

        var module = ResolveModule(source.ModuleId, catalog);

        return new ReplayModuleStateEvent
        {
            PacketIndex = source.PacketIndex,
            PacketOffset = source.PacketOffset,
            Time = source.ClockSeconds,
            EntityId = source.EntityId,
            ModuleId = source.ModuleId,
            ModuleKey = module.Key,
            ModuleName = module.Name,
            StateCode = source.StateCode,
            State = state,
            SourceEntityId = source.SourceEntityId,
            Source = ReplayModuleEventSources.Channel8Type20,
            Confidence = state == ReplayModuleStateNames.Unknown ? ReplayEventConfidences.Experimental : ReplayEventConfidences.Confirmed
        };
    }

    private static IReadOnlyList<ReplayModuleHitSummaryEvent> BuildModuleHitSummaryEvents(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId,
        ClientGameDataCatalog catalog, int idWidth)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(EntityMethodPacketDecoder.TryDecode)
            .Where(x => x is not null)
            .Select(x => x!)
            .SelectMany(x => ModulePacketDecoder.DecodeModuleHitSummary(x, idWidth))
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => ToReplayModuleHitSummaryEvent(x, catalog))
            .Where(x => x is not null)
            .Select(x => x!)
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ThenBy(x => x.ModuleId)
            .ToArray();
    }

    private static ReplayModuleHitSummaryEvent? ToReplayModuleHitSummaryEvent(
        ModuleHitSummaryCandidateFrame source,
        ClientGameDataCatalog catalog)
    {
        var state = ResolveType45ModuleState(source.StateCode);
        if (source.ModuleId == 0) return null;

        var module = ResolveModule(source.ModuleId, catalog);

        return new ReplayModuleHitSummaryEvent
        {
            PacketIndex = source.PacketIndex,
            PacketOffset = source.PacketOffset,
            Time = source.ClockSeconds,
            EntityId = source.EntityId,
            ModuleId = source.ModuleId,
            ModuleKey = module.Key,
            ModuleName = module.Name,
            StateCode = source.StateCode,
            State = state,
            Source = ReplayModuleEventSources.Channel8Type45,
            Confidence = state == ReplayModuleStateNames.Unknown ? ReplayEventConfidences.Experimental : ReplayEventConfidences.Confirmed
        };
    }

    private static IReadOnlyList<ReplayConsumableActivationEvent> BuildConsumableActivationEvents(
        IReadOnlyList<ReplayExtraStateFrame> extraStateFrames,
        IReadOnlyList<ReplayModuleStateEvent> moduleStateEvents)
    {
        if (extraStateFrames.Count == 0)
        {
            return [];
        }

        var result = new List<ReplayConsumableActivationEvent>();
        foreach (var group in extraStateFrames.Where(x => x.IsConsumable).GroupBy(x => (x.EntityId, x.ExtraId)))
        {
            var lastUse = (ReplayExtraStateFrame?)null;
            foreach (var frame in group.OrderBy(x => x.Time).ThenBy(x => x.PacketIndex))
            {
                if (frame.StateCode is not (2 or 3) || frame.TimerStamp <= 0) continue;
                // An active phase and its subsequent cooldown belong to ONE use.
                var sameUse = lastUse is not null && (
                    Math.Abs(frame.TimerStamp - lastUse.TimerStamp) < 0.5
                    || (lastUse.StateCode == 2 && frame.StateCode == 3
                        && Math.Abs(frame.TimerStamp - lastUse.TimerStamp - Math.Max(0, lastUse.Duration)) < 0.5));
                if (sameUse) continue;
                var direct = !frame.IsSnapshot && frame.StateCode == 2;
                // Cooldown can prove a use, but cannot provide an exact activation timestamp.
                result.Add(new ReplayConsumableActivationEvent
                {
                    Time = frame.Time,
                    ActivationTime = direct ? frame.Time : frame.StateCode == 2 ? frame.StateStartTime : null,
                    ActivationTimeIsExact = direct,
                    ActiveUntil = frame.StateCode == 2 ? frame.StateEndTime : null,
                    EntityId = frame.EntityId, ExtraId = frame.ExtraId, Key = frame.Key, Name = frame.Name,
                    Confidence = direct ? ReplayEventConfidences.Confirmed : ReplayEventConfidences.Inferred,
                    Evidence = direct ? "activationPacket" : frame.StateCode == 2 ? "activeSnapshot" : "cooldownObservation",
                    RepairedModules = direct && IsRepairKitExtra(frame.ExtraId)
                        ? BuildRepairedModulesForActivation(frame, moduleStateEvents) : []
                });
                lastUse = frame;
            }
        }
        return result.OrderBy(x => x.Time).ThenBy(x => x.EntityId).ThenBy(x => x.ExtraId).ToArray();
    }

    private static IReadOnlyList<ReplayRepairedModuleEvent> BuildRepairedModulesForActivation(
        ReplayExtraStateFrame activation,
        IReadOnlyList<ReplayModuleStateEvent> moduleStateEvents)
    {
        var explicitRestores = moduleStateEvents
            .Where(x => x.EntityId == activation.EntityId
                        && x.State == ReplayModuleStateNames.RestoredByRepairKit
                        && x.Time >= activation.Time - 0.05f
                        && x.Time <= activation.Time + 1.0f)
            .Select(x => new ReplayRepairedModuleEvent
            {
                Time = x.Time,
                EntityId = x.EntityId,
                ModuleId = x.ModuleId,
                ModuleKey = x.ModuleKey,
                ModuleName = x.ModuleName,
                Source = ReplayModuleEventSources.RepairKitExplicitModuleState,
                Confidence = ReplayEventConfidences.Confirmed
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.ModuleId)
            .ToArray();

        if (explicitRestores.Length > 0)
        {
            return explicitRestores;
        }

        return [];
    }

    private static (string Key, string Name, string Category, string SourceKind) ResolveExtra(
        int extraId,
        ClientGameDataCatalog catalog)
    {
        if (catalog.ExtrasByRuntimeId.TryGetValue(extraId, out var definition))
        {
            return (definition.Key, definition.DisplayName, definition.Category, definition.SourceKind);
        }

        if (KnownExtraFallbacks.TryGetValue(extraId, out var fallback))
        {
            return (fallback.Key, fallback.Name, fallback.Category, "confirmedFallback");
        }

        return ($"extra-{extraId}", $"Unknown extra {extraId}", "unknown", "unknown");
    }

    private static (string Key, string Name) ResolveModule(
        int moduleId,
        ClientGameDataCatalog catalog)
    {
        if (catalog.ModulesByRuntimeId.TryGetValue(moduleId, out var definition))
        {
            return (definition.Key, definition.DisplayName);
        }

        if (KnownModuleFallbacks.TryGetValue(moduleId, out var fallback))
        {
            return fallback;
        }

        return ($"module-{moduleId}", $"Unknown module {moduleId}");
    }

    private static bool IsConsumableExtra(
        int extraId,
        string category,
        string sourceKind)
    {
        if (KnownNonConsumableExtraIds.Contains(extraId))
        {
            return false;
        }

        return KnownConsumableExtraIds.Contains(extraId)
            || string.Equals(category, "consumable", StringComparison.OrdinalIgnoreCase)
            || string.Equals(sourceKind, "consumable", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRepairKitExtra(int extraId)
    {
        return extraId is 11 or 13;
    }

    private static string ResolveExtraState(int stateCode)
    {
        return stateCode switch
        {
            1 => ReplayExtraStateNames.Installed,
            2 => ReplayExtraStateNames.Activated,
            3 => ReplayExtraStateNames.Cooldown,
            255 => ReplayExtraStateNames.Cleanup,
            _ => ReplayExtraStateNames.Unknown
        };
    }

    private static string ResolveType20ModuleState(int stateCode)
    {
        return stateCode switch
        {
            4 => ReplayModuleStateNames.Damaged,
            5 => ReplayModuleStateNames.Destroyed,
            10 => ReplayModuleStateNames.Damaged,
            18 => ReplayModuleStateNames.AutoRestored,
            19 => ReplayModuleStateNames.RestoredByRepairKit,
            22 => ReplayModuleStateNames.RestoredByRepairKit,
            _ => ReplayModuleStateNames.Unknown
        };
    }

    private static string ResolveType45ModuleState(int stateCode)
    {
        return stateCode switch
        {
            1 => ReplayModuleStateNames.Damaged,
            2 => ReplayModuleStateNames.Destroyed,
            _ => ReplayModuleStateNames.Unknown
        };
    }

    private static string ResolveCompactModuleMarkerMeaning(int marker)
    {
        return marker switch
        {
            0xa4 => ReplayModuleStateNames.Damaged,
            0xa8 => ReplayModuleStateNames.Destroyed,
            0xa0 => ReplayModuleStateNames.TrackTimerMarker,
            _ => ReplayModuleStateNames.Unknown
        };
    }

    private static IReadOnlyList<ReplayVisibilityFrame> BuildVisibilityFrames(
        IReadOnlyList<ReplayPacket> packets,
        IReadOnlyDictionary<uint, ReplayVehicleInfo> vehiclesByEntityId)
    {
        if (vehiclesByEntityId.Count == 0)
        {
            return [];
        }

        return packets
            .Select(PropertyPacketDecoder.TryDecodeVisibilityCandidate)
            .Where(x => x is not null)
            .Select(x => x!)
            .Where(x => vehiclesByEntityId.ContainsKey(x.EntityId))
            .Select(x => new ReplayVisibilityFrame
            {
                Time = x.ClockSeconds,
                EntityId = x.EntityId,
                IsVisible = x.Value
            })
            .OrderBy(x => x.Time)
            .ThenBy(x => x.EntityId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayVisibilityInterval> BuildMovementBasedVisibilityIntervals(
        IReadOnlyList<ReplayMovementFrame> movementFrames,
        IReadOnlyList<ReplayDeathEvent> deathEvents,
        double? battleDuration)
    {
        const float maxMovementGapSeconds = 1.5f;

        if (movementFrames.Count == 0)
        {
            return [];
        }

        var result = new List<ReplayVisibilityInterval>();
        var battleEndTime = battleDuration is null
            ? (float?)null
            : (float)battleDuration.Value;
        var deathTimeByEntityId = deathEvents
            .GroupBy(x => x.EntityId)
            .ToDictionary(
                x => x.Key,
                x => x.Min(y => y.Time));

        foreach (var group in movementFrames
                     .GroupBy(x => x.EntityId)
                     .OrderBy(x => x.Key))
        {
            var ordered = group
                .OrderBy(x => x.Time)
                .ThenBy(x => x.SegmentIndex)
                .ToArray();

            if (ordered.Length == 0)
            {
                continue;
            }

            deathTimeByEntityId.TryGetValue(group.Key, out var deathTime);

            var startTime = ordered[0].Time;
            var previousTime = ordered[0].Time;

            for (var index = 1; index < ordered.Length; index++)
            {
                var currentTime = ordered[index].Time;

                if (deathTime > 0 && previousTime >= deathTime)
                {
                    break;
                }

                if (currentTime - previousTime > maxMovementGapSeconds)
                {
                    AddMovementVisibilityInterval(
                        result,
                        group.Key,
                        startTime,
                        previousTime,
                        deathTime,
                        battleEndTime);

                    if (deathTime > 0 && currentTime >= deathTime)
                    {
                        break;
                    }

                    startTime = currentTime;
                }

                previousTime = currentTime;
            }

            AddMovementVisibilityInterval(
                result,
                group.Key,
                startTime,
                previousTime,
                deathTime,
                battleEndTime);
        }

        return result
            .OrderBy(x => x.StartTime)
            .ThenBy(x => x.EntityId)
            .ToArray();
    }

    private static void AddMovementVisibilityInterval(
        ICollection<ReplayVisibilityInterval> result,
        uint entityId,
        float startTime,
        float endTime,
        float deathTime,
        float? battleEndTime)
    {
        if (deathTime > 0 && deathTime >= startTime && deathTime < endTime)
        {
            endTime = deathTime;
        }

        if (battleEndTime is not null && endTime > battleEndTime.Value)
        {
            endTime = battleEndTime.Value;
        }

        if (endTime < startTime)
        {
            return;
        }

        result.Add(new ReplayVisibilityInterval
        {
            EntityId = entityId,
            StartTime = startTime,
            EndTime = endTime,
            IsOpenEnded = battleEndTime is null && (deathTime <= 0 || endTime < deathTime)
        });
    }


    private static IReadOnlyList<ReplayDamageEvent> BuildDamageEvents(
        IReadOnlyList<ReplayHealthFrame> healthFrames)
    {
        if (healthFrames.Count == 0)
        {
            return [];
        }

        var result = new List<ReplayDamageEvent>();

        foreach (var group in healthFrames
                     .GroupBy(x => x.EntityId)
                     .OrderBy(x => x.Key))
        {
            ReplayHealthFrame? previous = null;

            foreach (var current in group
                         .OrderBy(x => x.Time)
                         .ThenBy(x => x.PacketIndex))
            {
                if (previous is not null && current.Health < previous.Health)
                {
                    result.Add(new ReplayDamageEvent
                    {
                        Time = current.Time,
                        TargetEntityId = current.EntityId,
                        PreviousHealth = previous.Health,
                        NewHealth = current.Health,
                        Damage = previous.Health - current.Health,
                        AttackerEntityId = null,
                        Source = current.Source == "entitySnapshot" ? "snapshotHealthDelta" : ReplayDerivedEventSources.HealthDelta
                    });
                }

                previous = current;
            }
        }

        return result
            .OrderBy(x => x.Time)
            .ThenBy(x => x.TargetEntityId)
            .ToArray();
    }

    private static IReadOnlyList<ReplayDeathEvent> BuildDeathEvents(
        IReadOnlyList<ReplayDamageEvent> damageEvents,
        IReadOnlyList<ReplayVehicleInfo> vehicles,
        IReadOnlyList<ReplayMovementFrame> movementFrames, ArenaEvents arena)
    {
        var result = arena.Kills.Select(k => new ReplayDeathEvent
        {
            Time = k.Time, EntityId = k.VictimEntityId, KillerEntityId = k.KillerEntityId,
            PreviousHealth = damageEvents.LastOrDefault(d => d.TargetEntityId == k.VictimEntityId && d.Time <= k.Time)?.PreviousHealth ?? 0,
            Source = "arenaKill"
        }).ToList();
        foreach (var vehicle in vehicles.Where(v => !result.Any(d => d.EntityId == v.EntityId)))
        {
            var death = damageEvents.FirstOrDefault(d => d.TargetEntityId == vehicle.EntityId && d.NewHealth <= 0);
            if (death is not null)
                result.Add(new ReplayDeathEvent { Time = death.Time, EntityId = vehicle.EntityId,
                    PreviousHealth = death.PreviousHealth, Source = death.Source,
                    Confidence = death.Source == "snapshotHealthDelta" ? ReplayEventConfidences.Inferred : ReplayEventConfidences.Confirmed });
            else if (vehicle.ResultDestroyed == true && arena.EndTime is not null)
                result.Add(new ReplayDeathEvent { Time = arena.EndTime.Value, EntityId = vehicle.EntityId,
                    Source = "battleResultsAtFinish", Confidence = ReplayEventConfidences.Inferred });
        }
        return result.OrderBy(x => x.Time).ThenBy(x => x.EntityId).ToArray();
    }

    public static ReplayTimelineSummary BuildTimelineSummary(ReplayParseResult result)
    {
        var startTime = FindMinTime(result);
        var endTime = FindMaxTime(result);

        return new ReplayTimelineSummary
        {
            ScoreEventCount = result.ScoreEvents.Count,
            ConfirmedKillEventCount = result.KillEvents.Count,
            StartTime = startTime,
            EndTime = endTime,
            BattleDuration = result.BattleDuration,
            VehicleCount = result.Vehicles.Count,
            MovementFrameCount = result.MovementFrames.Count,
            TurretFrameCount = result.TurretFrames.Count,
            ShotEventCount = result.ShotEvents.Count,
            ProjectilePointCount = result.ProjectilePoints.Count,
            HealthFrameCount = result.HealthFrames.Count,
            VisibilityFrameCount = result.VisibilityFrames.Count,
            VisibilityIntervalCount = result.VisibilityIntervals.Count,
            DamageEventCount = result.DamageEvents.Count,
            DeathEventCount = result.DeathEvents.Count,
            ExtraStateFrameCount = result.ExtraStateFrames.Count,
            ConsumableActivationCount = result.ConsumableActivationEvents.Count,
            ModuleStateEventCount = result.ModuleStateEvents.Count,
            ModuleHitSummaryEventCount = result.ModuleHitSummaryEvents.Count,
            ModuleCompactMarkerCount = result.ModuleCompactMarkers.Count,
            RepairedModuleCount = result.ConsumableActivationEvents.Sum(x => x.RepairedModules.Count),
            EffectiveHpVehicleCount = result.Vehicles.Count(x => x.EffectiveHp is not null),
            WarningCount = result.Warnings.Count,
            HasMovement = result.MovementFrames.Count > 0,
            HasVisibility = result.VisibilityFrames.Count > 0,
            HasDamage = result.DamageEvents.Count > 0,
            HasConsumables = result.ConsumableActivationEvents.Count > 0,
            HasModuleEvents = result.ModuleStateEvents.Count > 0
                              || result.ModuleHitSummaryEvents.Count > 0
                              || result.ModuleCompactMarkers.Count > 0
        };
    }

    private static IReadOnlyList<ReplayParseWarning> BuildParseWarnings(
        TbreplayArchive archive,
        ReplayMetaInfo metaInfo,
        BattleResultsInfo? battleResults,
        IReadOnlyList<ReplayVehicleInfo> vehicles,
        IReadOnlyList<ReplayMovementFrame> movementFrames,
        IReadOnlyList<ReplayVisibilityFrame> visibilityFrames,
        IReadOnlyList<ReplayHealthFrame> healthFrames)
    {
        var warnings = new List<ReplayParseWarning>();

        if (string.IsNullOrWhiteSpace(archive.MetaJson))
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.MetaJsonMissing,
                "meta.json отсутствует в .tbreplay, часть метаданных боя недоступна."));
        }
        else if (string.IsNullOrWhiteSpace(metaInfo.MapName))
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.MapNameMissing,
                "В meta.json не удалось найти имя карты."));
        }

        if (battleResults is null)
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.BattleResultsMissing,
                "battle_results.dat отсутствует или не распарсился, roster танков может быть пустым."));
        }

        if (vehicles.Count == 0)
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.RosterVehiclesMissing,
                "Не удалось получить список танков боя. Movement/visibility/health кадры без roster не попадут в результат."));
        }

        foreach (var vehicle in vehicles.Where(x => string.IsNullOrWhiteSpace(x.VehicleKey)))
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.VehicleDescriptorNotFound,
                $"Vehicle descriptor {vehicle.VehicleCompactDescriptor} не найден в ClientGameData.",
                vehicle.EntityId,
                vehicle.VehicleCompactDescriptor.ToString()));
        }

        if (movementFrames.Count == 0)
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.MovementFramesMissing,
                "Movement frames пустые. Реплей не получится проиграть на карте."));
        }

        if (visibilityFrames.Count == 0 && movementFrames.Count == 0)
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.VisibilityFramesMissing,
                "Visibility frames и movement frames пустые. Нельзя построить ни raw channel7 visibility, ни movement-based visibility."));
        }

        if (healthFrames.Count == 0)
        {
            warnings.Add(CreateWarning(
                ReplayParseWarningCodes.HealthFramesMissing,
                "Health frames пустые. Damage/death/effective HP события не будут построены."));
        }
        else if (vehicles.Count > 0)
        {
            var effectiveHpVehicleCount = vehicles.Count(x => x.EffectiveHp is not null);
            if (effectiveHpVehicleCount == 0)
            {
                warnings.Add(CreateWarning(
                    ReplayParseWarningCodes.EffectiveHpMissing,
                    "Не удалось вычислить effective HP ни для одного танка."));
            }
            else if (effectiveHpVehicleCount < vehicles.Count)
            {
                warnings.Add(CreateWarning(
                    ReplayParseWarningCodes.EffectiveHpPartial,
                    $"Effective HP вычислен только для {effectiveHpVehicleCount} из {vehicles.Count} танков."));
            }
        }

        return warnings;
    }

    private static ReplayParseWarning CreateWarning(
        string code,
        string message,
        uint? entityId = null,
        string? value = null)
    {
        return new ReplayParseWarning
        {
            Code = code,
            Message = message,
            EntityId = entityId,
            Value = value
        };
    }

    private static float? FindMinTime(ReplayParseResult result)
    {
        var values = new List<float>();
        values.AddRange(result.ScoreEvents.Select(x => x.Time));
        if (result.Outcome.EndTime is not null) values.Add(result.Outcome.EndTime.Value);
        values.AddRange(result.MovementFrames.Select(x => x.Time));
        values.AddRange(result.TurretFrames.Select(x => x.Time));
        values.AddRange(result.ShotEvents.Select(x => x.Time));
        values.AddRange(result.ProjectilePoints.Select(x => x.Time));
        values.AddRange(result.HealthFrames.Select(x => x.Time));
        values.AddRange(result.VisibilityFrames.Select(x => x.Time));
        values.AddRange(result.VisibilityIntervals.Select(x => x.StartTime));
        values.AddRange(result.DamageEvents.Select(x => x.Time));
        values.AddRange(result.DeathEvents.Select(x => x.Time));
        values.AddRange(result.ExtraStateFrames.Select(x => x.Time));
        values.AddRange(result.ConsumableActivationEvents.Select(x => x.Time));
        values.AddRange(result.ModuleStateEvents.Select(x => x.Time));
        values.AddRange(result.ModuleHitSummaryEvents.Select(x => x.Time));
        values.AddRange(result.ModuleCompactMarkers.Select(x => x.Time));

        return values.Count == 0 ? null : values.Min();
    }

    private static float? FindMaxTime(ReplayParseResult result)
    {
        var values = new List<float>();
        values.AddRange(result.ScoreEvents.Select(x => x.Time));
        if (result.Outcome.EndTime is not null) values.Add(result.Outcome.EndTime.Value);
        values.AddRange(result.MovementFrames.Select(x => x.Time));
        values.AddRange(result.TurretFrames.Select(x => x.Time));
        values.AddRange(result.ShotEvents.Select(x => x.Time));
        values.AddRange(result.ProjectilePoints.Select(x => x.Time));
        values.AddRange(result.HealthFrames.Select(x => x.Time));
        values.AddRange(result.VisibilityFrames.Select(x => x.Time));
        values.AddRange(result.VisibilityIntervals.Select(x => x.EndTime ?? x.StartTime));
        values.AddRange(result.DamageEvents.Select(x => x.Time));
        values.AddRange(result.DeathEvents.Select(x => x.Time));
        values.AddRange(result.ExtraStateFrames.Select(x => x.Time));
        values.AddRange(result.ConsumableActivationEvents.Select(x => x.Time));
        values.AddRange(result.ModuleStateEvents.Select(x => x.Time));
        values.AddRange(result.ModuleHitSummaryEvents.Select(x => x.Time));
        values.AddRange(result.ModuleCompactMarkers.Select(x => x.Time));

        return values.Count == 0 ? null : values.Max();
    }

    private static double? CalculateBattleDuration(
        IReadOnlyList<ReplayMovementFrame> movementFrames,
        IReadOnlyList<ReplayTurretFrame> turretFrames,
        IReadOnlyList<ReplayShotEvent> shotEvents,
        IReadOnlyList<ReplayProjectilePoint> projectilePoints,
        IReadOnlyList<ReplayHealthFrame> healthFrames,
        IReadOnlyList<ReplayVisibilityFrame> visibilityFrames,
        IReadOnlyList<ReplayExtraStateFrame> extraStateFrames,
        IReadOnlyList<ReplayConsumableActivationEvent> consumableActivationEvents,
        IReadOnlyList<ReplayModuleStateEvent> moduleStateEvents,
        IReadOnlyList<ReplayModuleHitSummaryEvent> moduleHitSummaryEvents,
        IReadOnlyList<ReplayModuleCompactMarker> moduleCompactMarkers)
    {
        var maxTime = new double?[]
            {
                movementFrames.Count == 0 ? null : movementFrames.Max(x => (double)x.Time),
                turretFrames.Count == 0 ? null : turretFrames.Max(x => (double)x.Time),
                shotEvents.Count == 0 ? null : shotEvents.Max(x => (double)x.Time),
                projectilePoints.Count == 0 ? null : projectilePoints.Max(x => (double)x.Time),
                healthFrames.Count == 0 ? null : healthFrames.Max(x => (double)x.Time),
                visibilityFrames.Count == 0 ? null : visibilityFrames.Max(x => (double)x.Time),
                extraStateFrames.Count == 0 ? null : extraStateFrames.Max(x => (double)x.Time),
                consumableActivationEvents.Count == 0 ? null : consumableActivationEvents.Max(x => (double)x.Time),
                moduleStateEvents.Count == 0 ? null : moduleStateEvents.Max(x => (double)x.Time),
                moduleHitSummaryEvents.Count == 0 ? null : moduleHitSummaryEvents.Max(x => (double)x.Time),
                moduleCompactMarkers.Count == 0 ? null : moduleCompactMarkers.Max(x => (double)x.Time)
            }
            .Where(x => x is not null)
            .DefaultIfEmpty()
            .Max();

        return maxTime;
    }

    private static bool ShouldStartNewSegment(
        MovementFrame previous,
        MovementFrame current)
    {
        const double maxGapSeconds = 1.0;
        const double maxStepDistanceXz = 30.0;
        const double maxStepSpeedXz = 35.0;

        var dt = current.ClockSeconds - previous.ClockSeconds;

        if (dt <= 0)
        {
            return false;
        }

        var dx = current.X - previous.X;
        var dz = current.Z - previous.Z;
        var distance = Math.Sqrt(dx * dx + dz * dz);
        var speed = distance / dt;

        return dt > maxGapSeconds
            || distance > maxStepDistanceXz
            || speed > maxStepSpeedXz;
    }

    private static long ToSignedAccountId(ulong accountId)
    {
        if (accountId <= long.MaxValue)
        {
            return (long)accountId;
        }

        return unchecked((long)accountId);
    }
}
