using System;
using System.Text.Json.Serialization;

namespace editor.Models;

public sealed class AppSettings
{
    [JsonPropertyName("parserConfig")]
    public ParserConfig ParserConfig { get; set; } = new();

    [JsonPropertyName("editorFontFamily")]
    public string EditorFontFamily { get; set; } = "微软雅黑";

    [JsonPropertyName("editorFontSize")]
    public double EditorFontSize { get; set; } = 18;

    [JsonPropertyName("editorTheme")]
    public string EditorTheme { get; set; } = "Default";

    [JsonPropertyName("backgroundImageFileName")]
    public string BackgroundImageFileName { get; set; } = string.Empty;

    [JsonPropertyName("backgroundImageOpacity")]
    public double BackgroundImageOpacity { get; set; } = 0.5;

    [JsonPropertyName("backgroundImageFillMode")]
    public bool BackgroundImageFillMode { get; set; } = false;

    [JsonPropertyName("openFiles")]
    public string[] OpenFiles { get; set; } = Array.Empty<string>();

    [JsonPropertyName("activeFile")]
    public string ActiveFile { get; set; } = string.Empty;

    [JsonPropertyName("recentFolders")]
    public string[] RecentFolders { get; set; } = Array.Empty<string>();

    [JsonPropertyName("simpleTmSharedUrl")]
    public string SimpleTmSharedUrl { get; set; } = string.Empty;
}