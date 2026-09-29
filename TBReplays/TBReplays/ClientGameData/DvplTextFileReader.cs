using System.Text;
using System.Xml.Linq;
using TBReplays.Dvpl;

namespace TBReplays.ClientGameData;

public sealed class DvplTextFileReader
{
    private readonly DvplDecoder _dvplDecoder;

    public DvplTextFileReader(DvplDecoder dvplDecoder)
    {
        _dvplDecoder = dvplDecoder;
    }

    public string ReadText(string path)
    {
        var bytes = _dvplDecoder.DecodeFile(path);
        return Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF');
    }

    public XDocument ReadXml(string path)
    {
        var text = ReadText(path);
        return XDocument.Parse(text, LoadOptions.None);
    }
}
