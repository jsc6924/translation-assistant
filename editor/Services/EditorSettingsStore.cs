using System;
using System.IO;
using System.Text.Json;
using editor.Models;

namespace editor.Services;

public sealed class EditorSettingsStore
{
    private const string SettingsFileName = "dltxt-editor-setting.json";
    private const string GlobalSettingsFileName = "dltxt-editor-global-settings.json";

    public AppSettings LoadSettings(string? workspacePath)
    {
        try
        {
            var settingsPath = GetSettingsPath(workspacePath);
            if (settingsPath is null || !File.Exists(settingsPath))
            {
                return new AppSettings();
            }

            var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(settingsPath));
            return settings ?? new AppSettings();
        }
        catch
        {
            return new AppSettings();
        }
    }

    public AppSettings LoadGlobalSettings()
    {
        try
        {
            var settingsPath = GetGlobalSettingsPath();
            if (string.IsNullOrWhiteSpace(settingsPath) || !File.Exists(settingsPath))
            {
                return new AppSettings();
            }

            var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(settingsPath));
            return settings ?? new AppSettings();
        }
        catch
        {
            return new AppSettings();
        }
    }

    public ParserConfig LoadParserConfig(string? workspacePath)
    {
        return LoadSettings(workspacePath).ParserConfig.Clone();
    }

    public void SaveSettings(string? workspacePath, AppSettings settings)
    {
        var settingsPath = GetSettingsPath(workspacePath);
        if (string.IsNullOrWhiteSpace(settingsPath))
        {
            return;
        }

        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions
        {
            WriteIndented = true,
        });
        File.WriteAllText(settingsPath, json);
    }

    public void SaveGlobalSettings(AppSettings settings)
    {
        var settingsPath = GetGlobalSettingsPath();
        if (string.IsNullOrWhiteSpace(settingsPath))
        {
            return;
        }

        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions
        {
            WriteIndented = true,
        });
        File.WriteAllText(settingsPath, json);
    }

    public void SaveParserConfig(string? workspacePath, ParserConfig parserConfig)
    {
        var settings = LoadSettings(workspacePath);
        settings.ParserConfig = parserConfig.Clone();
        SaveSettings(workspacePath, settings);
    }

    public static string? GetGlobalSettingsPath()
    {
        try
        {
            return Path.Combine(AppContext.BaseDirectory, GlobalSettingsFileName);
        }
        catch
        {
            return null;
        }
    }

    private static string? GetSettingsPath(string? workspacePath)
    {
        return string.IsNullOrWhiteSpace(workspacePath)
            ? null
            : Path.Combine(workspacePath, SettingsFileName);
    }
}