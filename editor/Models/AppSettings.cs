using System.Text.Json.Serialization;

namespace editor.Models;

public sealed class AppSettings
{
    [JsonPropertyName("parserConfig")]
    public ParserConfig ParserConfig { get; set; } = new();

    [JsonPropertyName("editorFontFamily")]
    public string EditorFontFamily { get; set; } = "黑体";

    [JsonPropertyName("editorFontSize")]
    public double EditorFontSize { get; set; } = 18;
}