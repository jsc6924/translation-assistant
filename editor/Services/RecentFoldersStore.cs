using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace editor.Services;

public sealed class RecentFoldersStore
{
    private const string FileName = "recent-folders.json";
    private readonly string _filePath;

    public RecentFoldersStore()
    {
        _filePath = Path.Combine(AppContext.BaseDirectory, FileName);
    }

    public IReadOnlyList<string> LoadRecentFolders()
    {
        try
        {
            if (!File.Exists(_filePath))
            {
                return Array.Empty<string>();
            }

            var folders = JsonSerializer.Deserialize<string[]>(File.ReadAllText(_filePath));
            return folders is null
                ? Array.Empty<string>()
                : folders
                    .Where(folder => !string.IsNullOrWhiteSpace(folder))
                    .Select(Path.GetFullPath)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(10)
                    .ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    public void SaveRecentFolders(IEnumerable<string> folders)
    {
        try
        {
            var items = folders
                .Where(folder => !string.IsNullOrWhiteSpace(folder))
                .Select(Path.GetFullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(10)
                .ToArray();

            var json = JsonSerializer.Serialize(items, new JsonSerializerOptions
            {
                WriteIndented = true,
            });

            File.WriteAllText(_filePath, json);
        }
        catch
        {
            // Ignore save failures to avoid breaking startup.
        }
    }
}
