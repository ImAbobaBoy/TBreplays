using System.Buffers.Binary;

namespace TBReplays.Maps;

/// <summary>Lossless DDS passthrough or PVR v3 RGBA conversion for the supplied DX11 assets.</summary>
public static class MapTextureConverter
{
    public static byte[] ToDds(byte[] data)
    {
        if (data.Length >= 128 && data.AsSpan(0, 4).SequenceEqual("DDS "u8)) return data;
        if (data.Length < 52 || BinaryPrimitives.ReadUInt32LittleEndian(data) != 0x03525650)
            throw new InvalidDataException("Ожидалась DDS или PVR v3 текстура.");
        var format = BinaryPrimitives.ReadUInt64LittleEndian(data.AsSpan(8));
        var height = checked((int)U32(24)); var width = checked((int)U32(28));
        var mips = checked((int)U32(44)); var offset = checked(52 + (int)U32(48));
        if (U32(32) != 1 || U32(36) != 1 || U32(40) != 1 || width <= 0 || height <= 0 || mips <= 0 || offset > data.Length)
            throw new NotSupportedException("Ожидалась двумерная PVR текстура без array/cubemap.");
        // PVR stores channel order in low 32 bits and bit depths in high 32 bits.
        var rgb565 = format == 0x0005060500626772;
        if (!rgb565 && ((uint)format != 0x61626772 || (format >> 32 != 0x08080808 && format >> 32 != 0x04040404)))
            throw new NotSupportedException($"Неподдерживаемый PVR pixelFormat 0x{format:x16}.");
        var bits = format >> 32 == 0x08080808 ? 32 : 16;
        long pixels = 0; int w = width, h = height;
        for (int i = 0; i < mips; i++) { pixels += (long)w * h; w = Math.Max(1, w / 2); h = Math.Max(1, h / 2); }
        if ((long)offset + pixels * (bits / 8) != data.Length) throw new InvalidDataException("Размер PVR mip payload не совпадает с заголовком.");
        var result = new byte[checked(128 + (int)pixels * 4)];
        "DDS "u8.CopyTo(result);
        Put(4, 124); Put(8, mips > 1 ? 0x2100f : 0x100f); Put(12, height); Put(16, width); Put(20, width * 4); Put(28, mips);
        Put(76, 32); Put(80, 0x41); Put(88, 32); Put(92, 0xff); Put(96, 0xff00); Put(100, 0xff0000); Put(104, unchecked((int)0xff000000));
        Put(108, mips > 1 ? 0x401008 : 0x1000);
        if (bits == 32) data.AsSpan(offset).CopyTo(result.AsSpan(128));
        else for (int i = 0; i < pixels; i++)
        {
            var pixel = BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(offset + i * 2));
            if (rgb565)
            {
                result[128 + i * 4] = (byte)(((pixel >> 11) & 31) * 255 / 31);
                result[129 + i * 4] = (byte)(((pixel >> 5) & 63) * 255 / 63);
                result[130 + i * 4] = (byte)((pixel & 31) * 255 / 31);
                result[131 + i * 4] = 255;
            }
            // Packed DX11 RGBA4 is R in the high nibble, A in the low nibble.
            else for (int channel = 0; channel < 4; channel++) result[128 + i * 4 + channel] = (byte)(((pixel >> ((3 - channel) * 4)) & 15) * 17);
        }
        return result;
        uint U32(int pos) => BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(pos));
        void Put(int pos, int value) => BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(pos), value);
    }
}
