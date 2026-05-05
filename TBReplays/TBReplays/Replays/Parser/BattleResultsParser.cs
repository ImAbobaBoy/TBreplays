using System.Buffers.Binary;
using System.Text;

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
    uint VehicleCompactDescriptor);

public sealed record BattleResultsInfo(
    ulong ArenaUniqueId,
    IReadOnlyList<PlayerRosterInfo> Players,
    IReadOnlyList<VehicleBattleInfo> Vehicles);

public static class BattleResultsParser
{
    private const byte ProtoOpcode = 0x80;
    private const byte Long1Opcode = 0x8a;
    private const byte BinStringOpcode = 0x54;

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

        var topLevelFields = ProtoReader.ReadFields(protobufBytes);
        var players = ReadPlayers(topLevelFields);
        var playerByAccountId = players.ToDictionary(x => x.AccountId, x => x);
        var vehicles = ReadVehicles(topLevelFields, playerByAccountId);

        return new BattleResultsInfo(arenaUniqueId, players, vehicles);
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

            playerByAccountId.TryGetValue(accountId.Value, out var player);

            result.Add(new VehicleBattleInfo(
                (uint)entityId.Value,
                accountId.Value,
                player?.Nickname ?? string.Empty,
                teamId,
                vehicleCompactDescriptor));
        }

        return result;
    }

    private static bool TryExtractPickleTuplePayload(byte[] pickleBytes, out ulong arenaUniqueId, out byte[] protobufBytes)
    {
        arenaUniqueId = 0;
        protobufBytes = [];

        // Minimal parser for battle_results.dat:
        // PROTO 2, LONG1 arenaId, BINSTRING protobufBytes, TUPLE2, STOP.
        if (pickleBytes.Length < 18 || pickleBytes[0] != ProtoOpcode || pickleBytes[1] != 2 || pickleBytes[2] != Long1Opcode)
        {
            return false;
        }

        var offset = 3;
        var longLength = pickleBytes[offset++];
        if (longLength <= 0 || offset + longLength >= pickleBytes.Length)
        {
            return false;
        }

        var arenaBytes = new byte[8];
        Array.Copy(pickleBytes, offset, arenaBytes, 0, Math.Min(longLength, arenaBytes.Length));
        arenaUniqueId = BinaryPrimitives.ReadUInt64LittleEndian(arenaBytes);
        offset += longLength;

        if (offset + 5 > pickleBytes.Length || pickleBytes[offset++] != BinStringOpcode)
        {
            return false;
        }

        var payloadLength = BinaryPrimitives.ReadInt32LittleEndian(pickleBytes.AsSpan(offset, 4));
        offset += 4;

        if (payloadLength < 0 || offset + payloadLength > pickleBytes.Length)
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
        if (length < 0 || offset + length > bytes.Length)
        {
            throw new EndOfStreamException("Unexpected end of protobuf length-delimited field.");
        }

        var result = bytes.AsSpan(offset, length).ToArray();
        offset += length;
        return result;
    }
}
