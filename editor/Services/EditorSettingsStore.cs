using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
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

    public bool HasSettings(string? workspacePath)
    {
        try
        {
            var settingsPath = GetSettingsPath(workspacePath);
            return !string.IsNullOrWhiteSpace(settingsPath) && File.Exists(settingsPath);
        }
        catch
        {
            return false;
        }
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
            var appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(appDataFolder))
            {
                return null;
            }

            var appFolder = Path.Combine(appDataFolder, "dltxt-editor");
            Directory.CreateDirectory(appFolder);
            return Path.Combine(appFolder, GlobalSettingsFileName);
        }
        catch
        {
            return null;
        }
    }

    public static string? GetGlobalSettingsDirectory()
    {
        try
        {
            var settingsPath = GetGlobalSettingsPath();
            if (string.IsNullOrWhiteSpace(settingsPath))
            {
                return null;
            }

            var directory = Path.GetDirectoryName(settingsPath);
            return string.IsNullOrWhiteSpace(directory) ? null : directory;
        }
        catch
        {
            return null;
        }
    }

    private static string? GetSettingsPath(string? workspacePath)
    {
        if (string.IsNullOrWhiteSpace(workspacePath))
        {
            return null;
        }

        if (OperatingSystem.IsAndroid())
        {
            var directory = GetWorkspaceSettingsDirectory();
            if (string.IsNullOrWhiteSpace(directory))
            {
                return null;
            }

            var workspaceId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(workspacePath)));
            return Path.Combine(directory, $"{workspaceId}-{SettingsFileName}");
        }

        return Path.Combine(workspacePath, SettingsFileName);
    }

    private static string? GetWorkspaceSettingsDirectory()
    {
        try
        {
            var globalDirectory = GetGlobalSettingsDirectory();
            if (string.IsNullOrWhiteSpace(globalDirectory))
            {
                return null;
            }

            var workspaceDirectory = Path.Combine(globalDirectory, "workspaces");
            Directory.CreateDirectory(workspaceDirectory);
            return workspaceDirectory;
        }
        catch
        {
            return null;
        }
    }
}