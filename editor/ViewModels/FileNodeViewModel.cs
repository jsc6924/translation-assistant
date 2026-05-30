using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;

namespace editor.ViewModels;

public sealed partial class FileNodeViewModel : ViewModelBase
{
    private static readonly HashSet<string> IgnoredNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git",
        ".vs",
        "bin",
        "obj",
    };

    private bool _isExpanded;
    private bool _isRenaming;
    private string _renameText = string.Empty;
    private string _displayName;

    public FileNodeViewModel(string fullPath, bool isDirectory, IEnumerable<FileNodeViewModel>? children = null, ISet<string>? expandedPaths = null)
    {
        FullPath = fullPath;
        IsDirectory = isDirectory;
        _displayName = Path.GetFileName(fullPath);
        RenameText = _displayName;
        Children = new ObservableCollection<FileNodeViewModel>(children ?? []);
        IsExpanded = expandedPaths?.Contains(fullPath) ?? false;
    }

    public string FullPath { get; private set; }

    public string DisplayName
    {
        get => _displayName;
        private set => SetProperty(ref _displayName, value);
    }

    public bool IsDirectory { get; }

    public ObservableCollection<FileNodeViewModel> Children { get; }

    public bool IsExpanded
    {
        get => _isExpanded;
        set => SetProperty(ref _isExpanded, value);
    }

    public bool IsRenaming
    {
        get => _isRenaming;
        set => SetProperty(ref _isRenaming, value);
    }

    public string RenameText
    {
        get => _renameText;
        set => SetProperty(ref _renameText, value);
    }

    public void BeginRename()
    {
        RenameText = DisplayName;
        IsRenaming = true;
    }

    public void UpdatePath(string newPath)
    {
        FullPath = newPath;
        DisplayName = Path.GetFileName(newPath);
    }

    public void ResetRenaming()
    {
        IsRenaming = false;
        RenameText = DisplayName;
    }

    public static IReadOnlyList<FileNodeViewModel> BuildChildren(string folderPath, ISet<string>? expandedPaths = null)
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

                nodes.Add(new FileNodeViewModel(directoryPath, true, BuildChildren(directoryPath, expandedPaths), expandedPaths));
            }

            foreach (var filePath in Directory.EnumerateFiles(folderPath).OrderBy(Path.GetFileName))
            {
                if (ShouldSkip(filePath))
                {
                    continue;
                }

                nodes.Add(new FileNodeViewModel(filePath, false, null, expandedPaths));
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