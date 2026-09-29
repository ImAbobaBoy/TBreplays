using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace TBReplays.ClientGameData;

public sealed class ClientGameDataLoader
{
    private static readonly Regex LocalizationLineRegex = new(
        "^\\s*\"(?<key>(?:\\\\.|[^\"\\\\])*)\"\\s*:\\s*\"(?<value>(?:\\\\.|[^\"\\\\])*)\"\\s*$",
        RegexOptions.Compiled);

    private readonly ClientGameDataPathResolver _pathResolver;
    private readonly DvplTextFileReader _fileReader;

    public ClientGameDataLoader(
        ClientGameDataPathResolver pathResolver,
        DvplTextFileReader fileReader)
    {
        _pathResolver = pathResolver;
        _fileReader = fileReader;
    }

    public ClientGameDataCatalog Load()
    {
        var versionPath = _pathResolver.Resolve();
        var warnings = new List<string>();

        var localization = LoadLocalization(versionPath.RootPath, warnings);
        var commonVehicleXml = LoadCommonVehicleXml(versionPath.RootPath, warnings);
        var runtimeExtrasByKey = commonVehicleXml is null
            ? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
            : LoadRuntimeExtrasByKey(commonVehicleXml);

        var modulesByRuntimeId = commonVehicleXml is null
            ? new Dictionary<int, ModuleDefinition>()
            : LoadModules(commonVehicleXml, localization);

        var extrasByKey = LoadExtras(
            versionPath.RootPath,
            localization,
            runtimeExtrasByKey,
            warnings);

        var extrasByRuntimeId = extrasByKey.Values
            .Where(x => x.RuntimeId is not null)
            .GroupBy(x => x.RuntimeId!.Value)
            .ToDictionary(
                x => x.Key,
                x => x.OrderBy(y => GetExtraSourcePriority(y.SourceKind)).First());

        var vehiclesByDescriptor = LoadVehicles(versionPath.RootPath, localization, warnings);
        var vehiclesByKey = vehiclesByDescriptor.Values
            .GroupBy(x => x.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(x => x.Key, x => x.First(), StringComparer.OrdinalIgnoreCase);

        return new ClientGameDataCatalog
        {
            Version = versionPath.Version,
            RootPath = versionPath.RootPath,
            Localization = localization,
            VehiclesByDescriptor = vehiclesByDescriptor,
            VehiclesByKey = vehiclesByKey,
            ExtrasByKey = extrasByKey,
            ExtrasByRuntimeId = extrasByRuntimeId,
            ModulesByRuntimeId = modulesByRuntimeId,
            Warnings = warnings
        };
    }

    private IReadOnlyDictionary<string, string> LoadLocalization(
        string versionRootPath,
        ICollection<string> warnings)
    {
        var path = Path.Combine(versionRootPath, "Strings", "ru.yaml.dvpl");
        if (!File.Exists(path))
        {
            warnings.Add($"ru.yaml.dvpl was not found: {path}");
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }

        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var text = _fileReader.ReadText(path);

        foreach (var line in text.Split('\n'))
        {
            var match = LocalizationLineRegex.Match(line.TrimEnd('\r'));
            if (!match.Success)
            {
                continue;
            }

            var key = DecodeQuotedYamlValue(match.Groups["key"].Value);
            var value = DecodeQuotedYamlValue(match.Groups["value"].Value);
            result[key] = value;
        }

        return result;
    }

    private XDocument? LoadCommonVehicleXml(
        string versionRootPath,
        ICollection<string> warnings)
    {
        var path = Path.Combine(versionRootPath, "XML", "item_defs", "vehicles", "common", "vehicle.xml.dvpl");
        if (!File.Exists(path))
        {
            warnings.Add($"common vehicle.xml.dvpl was not found: {path}");
            return null;
        }

        return _fileReader.ReadXml(path);
    }

    private static Dictionary<string, int> LoadRuntimeExtrasByKey(XDocument commonVehicleXml)
    {
        var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var extras = commonVehicleXml.Root?.Element("extras");
        if (extras is null)
        {
            return result;
        }

        foreach (var extra in extras.Elements())
        {
            var index = ReadIntAttribute(extra, "index");
            if (index is null)
            {
                continue;
            }

            result[extra.Name.LocalName] = index.Value;
        }

        return result;
    }

    private static Dictionary<int, ModuleDefinition> LoadModules(
        XDocument commonVehicleXml,
        IReadOnlyDictionary<string, string> localization)
    {
        var result = new Dictionary<int, ModuleDefinition>();
        var extras = commonVehicleXml.Root?.Element("extras");
        if (extras is null)
        {
            return result;
        }

        foreach (var extra in extras.Elements())
        {
            var key = extra.Name.LocalName;
            var runtimeId = ReadIntAttribute(extra, "index");
            if (runtimeId is null || !LooksLikeInternalModule(key, extra.Value))
            {
                continue;
            }

            result[runtimeId.Value] = new ModuleDefinition
            {
                RuntimeId = runtimeId.Value,
                Key = key,
                DisplayName = ResolveModuleName(key, localization),
                Source = "XML/item_defs/vehicles/common/vehicle.xml.dvpl:extras"
            };
        }

        return result;
    }

    private IReadOnlyDictionary<string, ExtraDefinition> LoadExtras(
        string versionRootPath,
        IReadOnlyDictionary<string, string> localization,
        IReadOnlyDictionary<string, int> runtimeExtrasByKey,
        ICollection<string> warnings)
    {
        var result = new Dictionary<string, ExtraDefinition>(StringComparer.OrdinalIgnoreCase);
        var commonPath = Path.Combine(versionRootPath, "XML", "item_defs", "vehicles", "common");

        LoadExtraFile(
            Path.Combine(commonPath, "optional_devices.xml.dvpl"),
            "optionalDevice",
            "optionalDevice",
            localization,
            runtimeExtrasByKey,
            result,
            warnings);

        LoadExtraDirectory(
            Path.Combine(commonPath, "consumables"),
            "consumable",
            localization,
            runtimeExtrasByKey,
            result,
            warnings);

        LoadExtraDirectory(
            Path.Combine(commonPath, "provisions"),
            "provision",
            localization,
            runtimeExtrasByKey,
            result,
            warnings);

        foreach (var (key, runtimeId) in runtimeExtrasByKey)
        {
            if (result.ContainsKey(key))
            {
                continue;
            }

            // TODO: Временное MVP-решение.
            // Сейчас runtime extra из common/vehicle.xml добавляется как fallback, если для него не найден item в consumables/provisions/optional_devices.
            // Потом заменить на строгий каталог replay runtime extras для конкретной версии клиента.
            // Убрать fallback unknown extra, когда появится подтверждённое соответствие runtime id -> XML item/key.
            result[key] = new ExtraDefinition
            {
                Id = runtimeId,
                RuntimeId = runtimeId,
                Key = key,
                Category = "unknown",
                SourceKind = "runtimeExtra",
                ScriptName = null,
                UserStringKey = null,
                DisplayName = ResolveExtraName(key, null, localization),
                MaxHpBonusPercent = null,
                ReloadBonusPercent = null,
                EnginePowerBonusPercent = null
            };
        }

        return result;
    }

    private void LoadExtraDirectory(
        string directoryPath,
        string sourceKind,
        IReadOnlyDictionary<string, string> localization,
        IReadOnlyDictionary<string, int> runtimeExtrasByKey,
        IDictionary<string, ExtraDefinition> result,
        ICollection<string> warnings)
    {
        if (!Directory.Exists(directoryPath))
        {
            warnings.Add($"{sourceKind} directory was not found: {directoryPath}");
            return;
        }

        foreach (var path in Directory.EnumerateFiles(directoryPath, "*.xml.dvpl", SearchOption.TopDirectoryOnly)
                     .OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
        {
            LoadExtraFile(
                path,
                sourceKind,
                sourceKind,
                localization,
                runtimeExtrasByKey,
                result,
                warnings);
        }
    }

    private void LoadExtraFile(
        string path,
        string sourceKind,
        string categoryFallback,
        IReadOnlyDictionary<string, string> localization,
        IReadOnlyDictionary<string, int> runtimeExtrasByKey,
        IDictionary<string, ExtraDefinition> result,
        ICollection<string> warnings)
    {
        if (!File.Exists(path))
        {
            warnings.Add($"{sourceKind} file was not found: {path}");
            return;
        }

        var document = _fileReader.ReadXml(path);
        if (document.Root is null)
        {
            return;
        }

        foreach (var item in document.Root.Elements())
        {
            var id = ReadIntElement(item, "id");
            var userStringKey = ReadStringElement(item, "userString");
            if (id is null || string.IsNullOrWhiteSpace(userStringKey))
            {
                continue;
            }

            var key = item.Name.LocalName;
            runtimeExtrasByKey.TryGetValue(key, out var runtimeId);
            var category = ReadStringElement(item, "category") ?? categoryFallback;
            var script = item.Element("script");

            var extra = new ExtraDefinition
            {
                Id = id.Value,
                RuntimeId = runtimeExtrasByKey.ContainsKey(key) ? runtimeId : null,
                Key = key,
                Category = category,
                SourceKind = sourceKind,
                ScriptName = ReadScriptName(script),
                UserStringKey = userStringKey,
                DisplayName = ResolveExtraName(key, userStringKey, localization),
                IsAbility = item.Element("isAbility") is not null,
                IsConsumable = sourceKind == "consumable" && item.Element("isAbility") is null,
                Icon = ReadStringElement(item, "icon"),
                DurationSeconds = ReadDoubleDescendant(item, "duration"),
                CooldownSeconds = ReadDoubleDescendant(item, "cooldown"),
                MaxHpBonusPercent = ReadDoubleDescendant(item, "maxHpBonusPercent"),
                ReloadBonusPercent = ReadDoubleDescendant(item, "gunReloadSpeedIncrease"),
                EnginePowerBonusPercent = ReadDoubleDescendant(item, "enginePowerIncrease")
            };

            result[key] = extra;
        }
    }

    private IReadOnlyDictionary<int, VehicleDefinition> LoadVehicles(
        string versionRootPath,
        IReadOnlyDictionary<string, string> localization,
        ICollection<string> warnings)
    {
        var vehiclesRoot = Path.Combine(versionRootPath, "XML", "item_defs", "vehicles");
        if (!Directory.Exists(vehiclesRoot))
        {
            warnings.Add($"vehicles directory was not found: {vehiclesRoot}");
            return new Dictionary<int, VehicleDefinition>();
        }

        var nationIds = LoadNationIds(versionRootPath, warnings);
        var vehicles = new Dictionary<int, VehicleDefinition>();

        foreach (var nationDirectory in Directory.EnumerateDirectories(vehiclesRoot)
                     .Where(x => !string.Equals(Path.GetFileName(x), "common", StringComparison.OrdinalIgnoreCase))
                     .OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
        {
            var nation = Path.GetFileName(nationDirectory);
            if (!nationIds.TryGetValue(nation, out var nationId))
            {
                warnings.Add($"Nation id was not found for directory: {nation}");
                continue;
            }

            var listPath = Path.Combine(nationDirectory, "list.xml.dvpl");
            if (!File.Exists(listPath))
            {
                warnings.Add($"Vehicle list was not found for nation {nation}: {listPath}");
                continue;
            }

            var turretIds = LoadComponentIds(Path.Combine(nationDirectory, "components", "turrets.xml.dvpl"));
            var gunIds = LoadComponentIds(Path.Combine(nationDirectory, "components", "guns.xml.dvpl"));
            var vehicleList = _fileReader.ReadXml(listPath);

            foreach (var vehicleMeta in vehicleList.Root?.Elements() ?? Enumerable.Empty<XElement>())
            {
                var vehicleId = ReadIntElement(vehicleMeta, "id");
                if (vehicleId is null)
                {
                    continue;
                }

                var key = vehicleMeta.Name.LocalName;
                var vehiclePath = Path.Combine(nationDirectory, key + ".xml.dvpl");
                if (!File.Exists(vehiclePath))
                {
                    continue;
                }

                var descriptor = BuildVehicleCompactDescriptor(nationId, vehicleId.Value);
                var vehicleXml = _fileReader.ReadXml(vehiclePath);
                var userStringKey = ReadStringElement(vehicleMeta, "userString");
                var turrets = LoadTurrets(vehicleXml, turretIds, localization);
                var guns = LoadGuns(vehicleXml, gunIds, localization);

                vehicles[descriptor] = new VehicleDefinition
                {
                    Descriptor = descriptor,
                    VehicleId = vehicleId.Value,
                    NationId = nationId,
                    Nation = nation,
                    Key = key,
                    UserStringKey = userStringKey,
                    DisplayName = ResolveVehicleName(key, userStringKey, localization),
                    Level = ReadIntElement(vehicleMeta, "level"),
                    Tags = ReadStringElement(vehicleMeta, "tags"),
                    HullHp = ReadIntElement(vehicleXml.Root?.Element("hull"), "maxHealth"),
                    TurretsById = turrets,
                    GunsById = guns,
                    SourcePath = vehiclePath
                };
            }
        }

        return vehicles;
    }

    private IReadOnlyDictionary<string, int> LoadNationIds(
        string versionRootPath,
        ICollection<string> warnings)
    {
        var path = Path.Combine(versionRootPath, "XML", "item_defs", "vehicles", "common", "nations.xml.dvpl");
        if (!File.Exists(path))
        {
            warnings.Add($"nations.xml.dvpl was not found: {path}");
            return new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        }

        var document = _fileReader.ReadXml(path);
        return document.Root?.Elements()
            .Select(x => new { Nation = x.Name.LocalName, Id = ReadIntElement(x, "id") })
            .Where(x => x.Id is not null)
            .ToDictionary(x => x.Nation, x => x.Id!.Value, StringComparer.OrdinalIgnoreCase)
            ?? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    }

    private IReadOnlyDictionary<string, int> LoadComponentIds(string path)
    {
        if (!File.Exists(path))
        {
            return new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        }

        var document = _fileReader.ReadXml(path);
        return document.Root?.Element("ids")?.Elements()
            .Select(x => new { Key = x.Name.LocalName, Id = ReadIntValue(x) })
            .Where(x => x.Id is not null)
            .ToDictionary(x => x.Key, x => x.Id!.Value, StringComparer.OrdinalIgnoreCase)
            ?? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    }

    private static IReadOnlyDictionary<int, TurretDefinition> LoadTurrets(
        XDocument vehicleXml,
        IReadOnlyDictionary<string, int> turretIds,
        IReadOnlyDictionary<string, string> localization)
    {
        var result = new Dictionary<int, TurretDefinition>();
        if (vehicleXml.Root is null)
        {
            return result;
        }

        var turretContainers = vehicleXml.Root.Elements()
            .Where(x => x.Name.LocalName.StartsWith("turrets", StringComparison.OrdinalIgnoreCase));

        foreach (var turret in turretContainers.SelectMany(x => x.Elements()))
        {
            var key = turret.Name.LocalName;
            if (!turretIds.TryGetValue(key, out var id))
            {
                continue;
            }

            var userStringKey = ReadStringElement(turret, "userString");
            result[id] = new TurretDefinition
            {
                Id = id,
                Key = key,
                UserStringKey = userStringKey,
                DisplayName = ResolveVehicleName(key, userStringKey, localization),
                MaxHealth = ReadIntElement(turret, "maxHealth")
            };
        }

        return result;
    }

    private static IReadOnlyDictionary<int, GunDefinition> LoadGuns(
        XDocument vehicleXml,
        IReadOnlyDictionary<string, int> gunIds,
        IReadOnlyDictionary<string, string> localization)
    {
        var result = new Dictionary<int, GunDefinition>();
        if (vehicleXml.Root is null)
        {
            return result;
        }

        var gunElements = vehicleXml.Root.Elements()
            .Where(x => x.Name.LocalName.StartsWith("turrets", StringComparison.OrdinalIgnoreCase))
            .SelectMany(x => x.Elements())
            .SelectMany(x => x.Element("guns")?.Elements() ?? Enumerable.Empty<XElement>());

        foreach (var gun in gunElements)
        {
            var key = gun.Name.LocalName;
            if (!gunIds.TryGetValue(key, out var id))
            {
                continue;
            }

            var userStringKey = ReadStringElement(gun, "userString");
            result[id] = new GunDefinition
            {
                Id = id,
                Key = key,
                UserStringKey = userStringKey,
                DisplayName = ResolveVehicleName(key, userStringKey, localization)
            };
        }

        return result;
    }

    private static int BuildVehicleCompactDescriptor(int nationId, int vehicleId)
    {
        var compactNationId = (nationId << 4) + 1;
        return (vehicleId << 8) | compactNationId;
    }

    private static bool LooksLikeInternalModule(string key, string value)
    {
        return key.EndsWith("Health", StringComparison.OrdinalIgnoreCase)
            || value.Contains("Health", StringComparison.OrdinalIgnoreCase)
            || key.Contains("Track", StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveModuleName(
        string key,
        IReadOnlyDictionary<string, string> localization)
    {
        return key switch
        {
            "engineHealth" => "Двигатель",
            "ammoBayHealth" => "Боеукладка",
            "fuelTankHealth" => "Топливный бак",
            "leftTrackHealth" => "Левая гусеница",
            "rightTrackHealth" => "Правая гусеница",
            "gunHealth" => "Орудие",
            "turretRotatorHealth" => "Механизм поворота башни",
            "surveyingDeviceHealth" => "Приборы наблюдения",
            "commanderHealth" => "Командир",
            "driverHealth" => "Механик-водитель",
            "gunner1Health" => "Наводчик 1",
            "gunner2Health" => "Наводчик 2",
            "loader1Health" => "Заряжающий 1",
            "loader2Health" => "Заряжающий 2",
            _ => SplitCamelCase(key)
        };
    }

    private static string ResolveExtraName(
        string key,
        string? userStringKey,
        IReadOnlyDictionary<string, string> localization)
    {
        if (!string.IsNullOrWhiteSpace(userStringKey)
            && localization.TryGetValue(userStringKey, out var localized))
        {
            return localized;
        }

        return SplitCamelCase(key);
    }

    private static string ResolveVehicleName(
        string key,
        string? userStringKey,
        IReadOnlyDictionary<string, string> localization)
    {
        if (!string.IsNullOrWhiteSpace(userStringKey)
            && localization.TryGetValue(userStringKey, out var localized))
        {
            return localized;
        }

        return key.Replace('_', ' ');
    }

    private static string SplitCamelCase(string value)
    {
        var withSpaces = Regex.Replace(value, "(?<!^)([A-Z])", " $1");
        return withSpaces.Replace('_', ' ');
    }

    private static string DecodeQuotedYamlValue(string value)
    {
        var result = new StringBuilder(value.Length);

        for (var i = 0; i < value.Length; i++)
        {
            var current = value[i];
            if (current != '\\' || i + 1 >= value.Length)
            {
                result.Append(current);
                continue;
            }

            var escaped = value[++i];

            switch (escaped)
            {
                case '0':
                    result.Append('\0');
                    break;

                case 'a':
                    result.Append('\a');
                    break;

                case 'b':
                    result.Append('\b');
                    break;

                case 't':
                    result.Append('\t');
                    break;

                case 'n':
                    result.Append('\n');
                    break;

                case 'v':
                    result.Append('\v');
                    break;

                case 'f':
                    result.Append('\f');
                    break;

                case 'r':
                    result.Append('\r');
                    break;

                case 'e':
                    result.Append('\u001B');
                    break;

                case '"':
                    result.Append('"');
                    break;

                case '\\':
                    result.Append('\\');
                    break;

                case '/':
                    result.Append('/');
                    break;

                case 'x' when TryReadHex(value, i + 1, 2, out var byteCode):
                    result.Append((char)byteCode);
                    i += 2;
                    break;

                case 'u' when TryReadHex(value, i + 1, 4, out var charCode):
                    result.Append((char)charCode);
                    i += 4;
                    break;

                case 'U' when TryReadHex(value, i + 1, 8, out var codePoint)
                              && IsValidUnicodeScalar(codePoint):
                    result.Append(char.ConvertFromUtf32(codePoint));
                    i += 8;
                    break;

                default:
                    result.Append('\\');
                    result.Append(escaped);
                    break;
            }
        }

        return result.ToString();
    }

    private static bool TryReadHex(
        string value,
        int startIndex,
        int length,
        out int result)
    {
        result = 0;

        if (startIndex + length > value.Length)
        {
            return false;
        }

        for (var offset = 0; offset < length; offset++)
        {
            var current = value[startIndex + offset];

            var digit = current switch
            {
                >= '0' and <= '9' => current - '0',
                >= 'a' and <= 'f' => current - 'a' + 10,
                >= 'A' and <= 'F' => current - 'A' + 10,
                _ => -1
            };

            if (digit < 0)
            {
                result = 0;
                return false;
            }

            result = (result << 4) + digit;
        }

        return true;
    }

    private static bool IsValidUnicodeScalar(int codePoint)
    {
        return codePoint is >= 0 and <= 0xD7FF
            or >= 0xE000 and <= 0x10FFFF;
    }

    private static int? ReadIntElement(XElement? element, string childName)
    {
        return ReadIntValue(element?.Element(childName));
    }

    private static int? ReadIntValue(XElement? element)
    {
        if (element is null)
        {
            return null;
        }

        return int.TryParse(
            element.Value.Trim(),
            NumberStyles.Integer,
            CultureInfo.InvariantCulture,
            out var value)
            ? value
            : null;
    }

    private static int? ReadIntAttribute(XElement element, string attributeName)
    {
        var value = element.Attribute(attributeName)?.Value;
        return int.TryParse(
            value,
            NumberStyles.Integer,
            CultureInfo.InvariantCulture,
            out var parsed)
            ? parsed
            : null;
    }

    private static string? ReadStringElement(XElement? element, string childName)
    {
        var value = element?.Element(childName)?.Value.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static double? ReadDoubleDescendant(XElement element, string descendantName)
    {
        var value = element.Descendants(descendantName).FirstOrDefault()?.Value.Trim();
        return double.TryParse(
            value,
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var parsed)
            ? parsed
            : null;
    }

    private static string? ReadScriptName(XElement? script)
    {
        return script?.Nodes()
            .OfType<XText>()
            .Select(x => x.Value.Trim())
            .FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
    }

    private static int GetExtraSourcePriority(string sourceKind)
    {
        return sourceKind switch
        {
            "consumable" => 0,
            "provision" => 1,
            "optionalDevice" => 2,
            _ => 10
        };
    }
}
