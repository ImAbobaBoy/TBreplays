using System.Buffers.Binary;
using System.Text;
using System.IO.Compression;
using System.Globalization;

namespace TBReplays.Replays.Parser;

public sealed record PlayerRosterInfo(
    ulong AccountId,
    string Nickname,
    int TeamId);

public sealed record VehicleBattleInfo(
    uint EntityId,
    ulong AccountId,
    string Nickname,
    int TeamId,
    uint VehicleCompactDescriptor,
    int? EffectiveHp,
    int? CurrentHp,
    int? DamageReceived,
    bool? IsDestroyed,
    IReadOnlyList<ProtoField>? RawFields = null);

public sealed record BattleResultsInfo(
    ulong ArenaUniqueId,
    IReadOnlyList<PlayerRosterInfo> Players,
    IReadOnlyList<VehicleBattleInfo> Vehicles,
    int? WinnerTeamId = null, int? FinishReasonCode = null,
    IReadOnlyList<ProtoField>? RawFields = null);

internal sealed record BattleResultHealth(
    int? EffectiveHp,
    int? CurrentHp,
    int? DamageReceived,
    bool? IsDestroyed);

public static class BattleResultsParser
{
    private const byte ProtoOpcode = 0x80;
    private const byte Long1Opcode = 0x8a;
    private const byte BinStringOpcode = 0x54;

    public static BattleResultsInfo? TryParsePackets(IReadOnlyList<ReplayPacket> packets)
    {
        foreach (var packet in packets.Where(x => x.Type == 13 && x.Payload.Length > 24).Reverse())
        {
            // This packet profile carries a zlib stream after its 22-byte header.
            if (packet.Payload[22] != 0x78) continue;
            try
            {
                using var input = new MemoryStream(packet.Payload, 22, packet.Payload.Length - 22);
                using var compressed = new ZLibStream(input, CompressionMode.Decompress);
                using var output = new MemoryStream();
                var buffer = new byte[8192];
                var read = 0;
                while ((read = compressed.Read(buffer)) > 0)
                {
                    if (output.Length + read > 16 * 1024 * 1024) throw new InvalidDataException("Results too large.");
                    output.Write(buffer, 0, read);
                }
                var result = TryParse(output.ToArray());
                if (result is not null) return result;
            }
            catch (IOException) { /* Missing/corrupt optional final results. */ }
        }
        return null;
    }

    public static BattleResultsInfo? TryParse(byte[]? battleResultsBytes)
    {
        if (battleResultsBytes is null || battleResultsBytes.Length == 0)
        {
            return null;
        }

        if (!TryExtractPickleTuplePayload(battleResultsBytes, out var arenaUniqueId, out var protobufBytes))
        {
            return null;
        }

        try
        {
            var topLevelFields = ProtoReader.ReadFields(protobufBytes);
            var players = ReadPlayers(topLevelFields);
            var playerByAccountId = players.ToDictionary(x => x.AccountId, x => x);
            var vehicles = ReadVehicles(topLevelFields, playerByAccountId);

            return new BattleResultsInfo(arenaUniqueId, players, vehicles,
                (int)(topLevelFields.FirstOrDefault(x => x.FieldNumber == 3)?.VarintValue ?? 0),
                ToInt32(topLevelFields.FirstOrDefault(x => x.FieldNumber == 4)?.VarintValue), topLevelFields);
        }
        catch (Exception e) when (e is IOException or OverflowException or ArgumentException)
        {
            return null;
        }
    }

    private static IReadOnlyList<PlayerRosterInfo> ReadPlayers(IReadOnlyList<ProtoField> topLevelFields)
    {
        var result = new List<PlayerRosterInfo>();

        foreach (var field in topLevelFields.Where(x => x.FieldNumber == 201 && x.WireType == ProtoWireType.LengthDelimited))
        {
            var playerEnvelope = ProtoReader.ReadFields(field.BytesValue);
            var accountId = playerEnvelope.FirstOrDefault(x => x.FieldNumber == 1 && x.WireType == ProtoWireType.Varint)?.VarintValue;
            var nested = playerEnvelope.FirstOrDefault(x => x.FieldNumber == 2 && x.WireType == ProtoWireType.LengthDelimited);
            if (accountId is null || nested is null)
            {
                continue;
            }

            var playerFields = ProtoReader.ReadFields(nested.BytesValue);
            var nickname = playerFields.FirstOrDefault(x => x.FieldNumber == 1 && x.WireType == ProtoWireType.LengthDelimited)?.AsUtf8String() ?? string.Empty;
            var teamId = (int)(playerFields.FirstOrDefault(x => x.FieldNumber == 3 && x.WireType == ProtoWireType.Varint)?.VarintValue ?? 0);

            result.Add(new PlayerRosterInfo(accountId.Value, nickname, teamId));
        }

        return result;
    }

    private static IReadOnlyList<VehicleBattleInfo> ReadVehicles(
        IReadOnlyList<ProtoField> topLevelFields,
        IReadOnlyDictionary<ulong, PlayerRosterInfo> playerByAccountId)
    {
        var result = new List<VehicleBattleInfo>();

        foreach (var field in topLevelFields.Where(x => x.FieldNumber == 301 && x.WireType == ProtoWireType.LengthDelimited))
        {
            var vehicleEnvelope = ProtoReader.ReadFields(field.BytesValue);
            var entityId = vehicleEnvelope.FirstOrDefault(x => x.FieldNumber == 1 && x.WireType == ProtoWireType.Varint)?.VarintValue;
            var nested = vehicleEnvelope.FirstOrDefault(x => x.FieldNumber == 2 && x.WireType == ProtoWireType.LengthDelimited);
            if (entityId is null || nested is null)
            {
                continue;
            }

            var vehicleFields = ProtoReader.ReadFields(nested.BytesValue);
            var accountId = vehicleFields.FirstOrDefault(x => x.FieldNumber == 101 && x.WireType == ProtoWireType.Varint)?.VarintValue;
            var teamId = (int)(vehicleFields.FirstOrDefault(x => x.FieldNumber == 102 && x.WireType == ProtoWireType.Varint)?.VarintValue ?? 0);
            var vehicleCompactDescriptor = (uint)(vehicleFields.FirstOrDefault(x => x.FieldNumber == 103 && x.WireType == ProtoWireType.Varint)?.VarintValue ?? 0);

            if (accountId is null)
            {
                continue;
            }

            var resultHealth = TryReadResultHealth(vehicleFields);
            playerByAccountId.TryGetValue(accountId.Value, out var player);

            result.Add(new VehicleBattleInfo(
                (uint)entityId.Value,
                accountId.Value,
                player?.Nickname ?? string.Empty,
                teamId,
                vehicleCompactDescriptor,
                resultHealth.EffectiveHp,
                resultHealth.CurrentHp,
                resultHealth.DamageReceived,
                resultHealth.IsDestroyed, vehicleFields));
        }

        return result;
    }

    private static BattleResultHealth TryReadResultHealth(IReadOnlyList<ProtoField> vehicleFields)
    {
        var field1 = vehicleFields.FirstOrDefault(x => x.FieldNumber == 1 && x.WireType == ProtoWireType.Varint)?.VarintValue ?? 0;
        var field11 = vehicleFields.FirstOrDefault(x => x.FieldNumber == 11 && x.WireType == ProtoWireType.Varint)?.VarintValue ?? 0;

        // TODO TBREPLAYS-REPLAY-PROTOCOL:
        // Field 1 / field 11 interpretation is validated on current replay samples.
        // For destroyed vehicles field 1 may contain a huge sentinel value, while field 11
        // contains effective battle HP. For survived vehicles field 1 is remaining HP and
        // field 11 is received damage. Keep health frames as fallback until more samples confirm
        // this schema across battle modes and client versions.
        if (field1 > long.MaxValue)
        {
            return new BattleResultHealth(
                field11 > 0 ? ToInt32(field11) : null,
                0,
                ToInt32(field11),
                true);
        }

        var currentHp = ToInt32(field1);
        var damageReceived = ToInt32(field11);
        var effectiveHp = currentHp is null || damageReceived is null
            ? (int?)null
            : checked(currentHp.Value + damageReceived.Value);

        return new BattleResultHealth(
            effectiveHp is > 0 ? effectiveHp : null,
            currentHp,
            damageReceived,
            currentHp == 0);
    }

    private static int? ToInt32(ulong? value)
    {
        if (value is null || value.Value > int.MaxValue)
        {
            return null;
        }

        return (int)value.Value;
    }

    private static bool TryExtractPickleTuplePayload(byte[] pickleBytes, out ulong arenaUniqueId, out byte[] protobufBytes)
    {
        arenaUniqueId = 0;
        protobufBytes = [];

        // Minimal parser for battle_results.dat:
        // PROTO 2, LONG1 arenaId, BINSTRING protobufBytes, TUPLE2, STOP.
        if (pickleBytes.Length < 8 || pickleBytes[0] != ProtoOpcode || pickleBytes[1] != 2)
        {
            return false;
        }

        var offset = 3;
        if (pickleBytes[2] == Long1Opcode)
        {
            var longLength = pickleBytes[offset++];
            if (longLength is < 1 or > 9 || offset + longLength >= pickleBytes.Length
                || (longLength == 9 && pickleBytes[offset + 8] != 0)) return false;
            var arenaBytes = new byte[8];
            Array.Copy(pickleBytes, offset, arenaBytes, 0, Math.Min(longLength, arenaBytes.Length));
            arenaUniqueId = BinaryPrimitives.ReadUInt64LittleEndian(arenaBytes);
            offset += longLength;
        }
        else if (pickleBytes[2] is 0x49 or 0x4c) // INT / LONG decimal, never execute pickle instructions.
        {
            var end = Array.IndexOf(pickleBytes, (byte)'\n', offset);
            if (end < 0 || end - offset > 21) return false;
            var number = Encoding.ASCII.GetString(pickleBytes, offset, end - offset).TrimEnd('L');
            if (!ulong.TryParse(number, NumberStyles.None, CultureInfo.InvariantCulture, out arenaUniqueId)) return false;
            offset = end + 1;
        }
        else return false;

        if (offset + 5 > pickleBytes.Length || pickleBytes[offset++] != BinStringOpcode)
        {
            return false;
        }

        var payloadLength = BinaryPrimitives.ReadInt32LittleEndian(pickleBytes.AsSpan(offset, 4));
        offset += 4;

        if (payloadLength < 0 || payloadLength > pickleBytes.Length - offset)
        {
            return false;
        }

        protobufBytes = pickleBytes.AsSpan(offset, payloadLength).ToArray();
        return true;
    }
}

public enum ProtoWireType
{
    Varint = 0,
    Fixed64 = 1,
    LengthDelimited = 2,
    Fixed32 = 5
}

public sealed record ProtoField(
    int FieldNumber,
    ProtoWireType WireType,
    ulong? VarintValue,
    byte[] BytesValue)
{
    public string? AsUtf8String()
    {
        if (WireType != ProtoWireType.LengthDelimited)
        {
            return null;
        }

        try
        {
            return Encoding.UTF8.GetString(BytesValue);
        }
        catch
        {
            return null;
        }
    }
}

public static class ProtoReader
{
    public static IReadOnlyList<ProtoField> ReadFields(byte[] bytes)
    {
        var result = new List<ProtoField>();
        var offset = 0;

        while (offset < bytes.Length)
        {
            var tag = ReadVarint(bytes, ref offset);
            if ((tag >> 3) == 0 || (tag >> 3) > 536870911)
                throw new InvalidDataException("Invalid protobuf field number.");
            var fieldNumber = (int)(tag >> 3);
            var wireType = (ProtoWireType)(tag & 0x07);

            switch (wireType)
            {
                case ProtoWireType.Varint:
                    result.Add(new ProtoField(fieldNumber, wireType, ReadVarint(bytes, ref offset), []));
                    break;

                case ProtoWireType.Fixed64:
                    result.Add(new ProtoField(fieldNumber, wireType, null, ReadBytes(bytes, ref offset, 8)));
                    break;

                case ProtoWireType.LengthDelimited:
                    var length = checked((int)ReadVarint(bytes, ref offset));
                    result.Add(new ProtoField(fieldNumber, wireType, null, ReadBytes(bytes, ref offset, length)));
                    break;

                case ProtoWireType.Fixed32:
                    result.Add(new ProtoField(fieldNumber, wireType, null, ReadBytes(bytes, ref offset, 4)));
                    break;

                default:
                    throw new InvalidDataException($"Unsupported protobuf wire type {wireType} at offset {offset}.");
            }
        }

        return result;
    }

    private static ulong ReadVarint(byte[] bytes, ref int offset)
    {
        var result = 0UL;
        var shift = 0;

        while (offset < bytes.Length)
        {
            var current = bytes[offset++];
            if (shift == 63 && current > 1) throw new InvalidDataException("Protobuf varint overflow.");
            result |= (ulong)(current & 0x7F) << shift;

            if ((current & 0x80) == 0)
            {
                return result;
            }

            shift += 7;
            if (shift > 63)
            {
                throw new InvalidDataException("Invalid protobuf varint.");
            }
        }

        throw new EndOfStreamException("Unexpected end of protobuf varint.");
    }

    private static byte[] ReadBytes(byte[] bytes, ref int offset, int length)
    {
        if (length < 0 || length > bytes.Length - offset)
        {
            throw new EndOfStreamException("Unexpected end of protobuf length-delimited field.");
        }

        var result = bytes.AsSpan(offset, length).ToArray();
        offset += length;
        return result;
    }
}
