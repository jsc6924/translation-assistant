using System.IO;
using System.Text.Json;
using editor.Models;

namespace editor.Services;

public sealed class EditorSettingsStore
{
    private const string SettingsFileName = "dltxt-editor-setting.json";

    public ParserConfig LoadParserConfig(string? workspacePath)
    {
        try
        {
            var settingsPath = GetSettingsPath(workspacePath);
            if (settingsPath is null || !File.Exists(settingsPath))
            {
                return new ParserConfig();
            }

            var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(settingsPath));
            return settings?.ParserConfig?.Clone() ?? new ParserConfig();
        }
        catch
        {
            return new ParserConfig();
        }
    }

    public void SaveParserConfig(string? workspacePath, ParserConfig parserConfig)
    {
        var settingsPath = GetSettingsPath(workspacePath);
        if (string.IsNullOrWhiteSpace(settingsPath))
        {
            return;
        }

        var settings = new AppSettings
        {
            ParserConfig = parserConfig.Clone(),
        };
        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions
        {
            WriteIndented = true,
        });
        File.WriteAllText(settingsPath, json);
    }

    private static string? GetSettingsPath(string? workspacePath)
    {
        return string.IsNullOrWhiteSpace(workspacePath)
            ? null
            : Path.Combine(workspacePath, SettingsFileName);
    }
}