using System.Text.Json.Serialization;

namespace editor.Models;

public sealed class AppSettings
{
    [JsonPropertyName("parserConfig")]
    public ParserConfig ParserConfig { get; set; } = new();
}