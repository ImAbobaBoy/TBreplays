namespace TBReplays.ClientGameData;

public sealed record ClientGameDataCatalog
{
    public required string Version { get; init; }
    public required string RootPath { get; init; }
    public required IReadOnlyDictionary<string, string> Localization { get; init; }
    public required IReadOnlyDictionary<int, VehicleDefinition> VehiclesByDescriptor { get; init; }
    public required IReadOnlyDictionary<string, VehicleDefinition> VehiclesByKey { get; init; }
    public required IReadOnlyDictionary<string, ExtraDefinition> ExtrasByKey { get; init; }
    public required IReadOnlyDictionary<int, ExtraDefinition> ExtrasByRuntimeId { get; init; }
    public required IReadOnlyDictionary<int, ModuleDefinition> ModulesByRuntimeId { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
}

public sealed record VehicleDefinition
{
    public required int Descriptor { get; init; }
    public required int VehicleId { get; init; }
    public required int NationId { get; init; }
    public required string Nation { get; init; }
    public required string Key { get; init; }
    public required string? UserStringKey { get; init; }
    public required string DisplayName { get; init; }
    public required int? Level { get; init; }
    public required string? Tags { get; init; }
    public required int? HullHp { get; init; }
    public required IReadOnlyDictionary<int, TurretDefinition> TurretsById { get; init; }
    public required IReadOnlyDictionary<int, GunDefinition> GunsById { get; init; }
    public required string SourcePath { get; init; }
}

public sealed record TurretDefinition
{
    public required int Id { get; init; }
    public required string Key { get; init; }
    public required string? UserStringKey { get; init; }
    public required string DisplayName { get; init; }
    public required int? MaxHealth { get; init; }
}

public sealed record GunDefinition
{
    public required int Id { get; init; }
    public required string Key { get; init; }
    public required string? UserStringKey { get; init; }
    public required string DisplayName { get; init; }
}

public sealed record ExtraDefinition
{
    public required int Id { get; init; }
    public required int? RuntimeId { get; init; }
    public required string Key { get; init; }
    public required string Category { get; init; }
    public required string SourceKind { get; init; }
    public required string? ScriptName { get; init; }
    public required string? UserStringKey { get; init; }
    public required string DisplayName { get; init; }
    public bool IsAbility { get; init; }
    public bool IsConsumable { get; init; }
    public string? Icon { get; init; }
    public double? DurationSeconds { get; init; }
    public double? CooldownSeconds { get; init; }
    public double? MaxHpBonusPercent { get; init; }
    public double? ReloadBonusPercent { get; init; }
    public double? EnginePowerBonusPercent { get; init; }
}

public sealed record ModuleDefinition
{
    public required int RuntimeId { get; init; }
    public required string Key { get; init; }
    public required string DisplayName { get; init; }
    public required string Source { get; init; }
}

public sealed record ClientGameDataSummaryDto
{
    public required string Version { get; init; }
    public required string RootPath { get; init; }
    public required bool HasRuLocalization { get; init; }
    public required int LocalizationKeys { get; init; }
    public required int Vehicles { get; init; }
    public required int VehiclesWithHullHp { get; init; }
    public required int VehicleTurrets { get; init; }
    public required int VehicleGuns { get; init; }
    public required int Extras { get; init; }
    public required int RuntimeExtras { get; init; }
    public required int Modules { get; init; }
    public required IReadOnlyList<ClientGameDataVehicleSampleDto> SampleVehicles { get; init; }
    public required IReadOnlyList<ClientGameDataExtraSampleDto> SampleExtras { get; init; }
    public required IReadOnlyList<ClientGameDataModuleSampleDto> SampleModules { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
}

public sealed record ClientGameDataVehicleSampleDto
{
    public required int Descriptor { get; init; }
    public required int VehicleId { get; init; }
    public required string Nation { get; init; }
    public required string Key { get; init; }
    public required string DisplayName { get; init; }
    public required int? Level { get; init; }
    public required int? HullHp { get; init; }
    public required int Turrets { get; init; }
    public required int Guns { get; init; }
}

public sealed record ClientGameDataExtraSampleDto
{
    public required int Id { get; init; }
    public required int? RuntimeId { get; init; }
    public required string Key { get; init; }
    public required string Category { get; init; }
    public required string SourceKind { get; init; }
    public required string DisplayName { get; init; }
}

public sealed record ClientGameDataModuleSampleDto
{
    public required int RuntimeId { get; init; }
    public required string Key { get; init; }
    public required string DisplayName { get; init; }
}
