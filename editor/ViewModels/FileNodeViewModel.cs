using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;

namespace editor.ViewModels;

public sealed class FileNodeViewModel : ViewModelBase
{
    private static readonly HashSet<string> IgnoredNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git",
        ".vs",
        "bin",
        "obj",
    };

    public FileNodeViewModel(string fullPath, bool isDirectory, IEnumerable<FileNodeViewModel>? children = null)
    {
        FullPath = fullPath;
        IsDirectory = isDirectory;
        DisplayName = Path.GetFileName(fullPath);
        Children = new ObservableCollection<FileNodeViewModel>(children ?? []);
    }

    public string FullPath { get; }

    public string DisplayName { get; }

    public bool IsDirectory { get; }

    public ObservableCollection<FileNodeViewModel> Children { get; }

    public static IReadOnlyList<FileNodeViewModel> BuildChildren(string folderPath)
    {
        var nodes = new List<FileNodeViewModel>();

        try
        {
            foreach (var directoryPath in Directory.EnumerateDirectories(folderPath).OrderBy(Path.GetFileName))
            {
                if (ShouldSkip(directoryPath))
                {
                    continue;
                }

                nodes.Add(new FileNodeViewModel(directoryPath, true, BuildChildren(directoryPath)));
            }

            foreach (var filePath in Directory.EnumerateFiles(folderPath).OrderBy(Path.GetFileName))
            {
                if (ShouldSkip(filePath))
                {
                    continue;
                }

                nodes.Add(new FileNodeViewModel(filePath, false));
            }
        }
        catch
        {
            return nodes;
        }

        return nodes;
    }

    private static bool ShouldSkip(string path)
    {
        var name = Path.GetFileName(path);
        if (string.IsNullOrWhiteSpace(name) || IgnoredNames.Contains(name))
        {
            return true;
        }

        try
        {
            var attributes = File.GetAttributes(path);
            return attributes.HasFlag(FileAttributes.Hidden) || attributes.HasFlag(FileAttributes.System);
        }
        catch
        {
            return true;
        }
    }
}