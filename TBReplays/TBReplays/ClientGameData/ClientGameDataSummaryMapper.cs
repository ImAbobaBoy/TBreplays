namespace TBReplays.ClientGameData;

public static class ClientGameDataSummaryMapper
{
    public static ClientGameDataSummaryDto ToSummaryDto(ClientGameDataCatalog catalog)
    {
        return new ClientGameDataSummaryDto
        {
            Version = catalog.Version,
            RootPath = catalog.RootPath,
            HasRuLocalization = catalog.Localization.Count > 0,
            LocalizationKeys = catalog.Localization.Count,
            Vehicles = catalog.VehiclesByDescriptor.Count,
            VehiclesWithHullHp = catalog.VehiclesByDescriptor.Values.Count(x => x.HullHp is not null),
            VehicleTurrets = catalog.VehiclesByDescriptor.Values.Sum(x => x.TurretsById.Count),
            VehicleGuns = catalog.VehiclesByDescriptor.Values.Sum(x => x.GunsById.Count),
            Extras = catalog.ExtrasByKey.Count,
            RuntimeExtras = catalog.ExtrasByRuntimeId.Count,
            Modules = catalog.ModulesByRuntimeId.Count,
            SampleVehicles = catalog.VehiclesByDescriptor.Values
                .OrderBy(x => x.Nation, StringComparer.OrdinalIgnoreCase)
                .ThenBy(x => x.VehicleId)
                .Take(12)
                .Select(x => new ClientGameDataVehicleSampleDto
                {
                    Descriptor = x.Descriptor,
                    VehicleId = x.VehicleId,
                    Nation = x.Nation,
                    Key = x.Key,
                    DisplayName = x.DisplayName,
                    Level = x.Level,
                    HullHp = x.HullHp,
                    Turrets = x.TurretsById.Count,
                    Guns = x.GunsById.Count
                })
                .ToArray(),
            SampleExtras = catalog.ExtrasByKey.Values
                .OrderBy(x => x.SourceKind, StringComparer.OrdinalIgnoreCase)
                .ThenBy(x => x.RuntimeId ?? int.MaxValue)
                .ThenBy(x => x.Id)
                .Take(16)
                .Select(x => new ClientGameDataExtraSampleDto
                {
                    Id = x.Id,
                    RuntimeId = x.RuntimeId,
                    Key = x.Key,
                    Category = x.Category,
                    SourceKind = x.SourceKind,
                    DisplayName = x.DisplayName
                })
                .ToArray(),
            SampleModules = catalog.ModulesByRuntimeId.Values
                .OrderBy(x => x.RuntimeId)
                .Select(x => new ClientGameDataModuleSampleDto
                {
                    RuntimeId = x.RuntimeId,
                    Key = x.Key,
                    DisplayName = x.DisplayName
                })
                .ToArray(),
            Warnings = catalog.Warnings
        };
    }
}
