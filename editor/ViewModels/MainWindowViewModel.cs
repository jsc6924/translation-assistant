using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using editor.Models;
using editor.Services;

namespace editor.ViewModels;

public partial class MainWindowViewModel : ViewModelBase
{
    private readonly EditorSettingsStore _settingsStore;
    private readonly RecentFoldersStore _recentFoldersStore;
    private EditorDocumentViewModel? _selectedDocument;
    private string? _workspacePath;
    private string _simpleTmSharedUrl = string.Empty;

    [ObservableProperty]
    private string _statusMessage = "请选择最近打开的文件夹，或打开一个新的文件夹。";

    [ObservableProperty]
    private bool _enableEditRestriction = true;

    [ObservableProperty]
    private bool _enableTranslationMode;

    [ObservableProperty]
    private string _editorFontFamilyName = "黑体";

    [ObservableProperty]
    private double _editorFontSize = 18;

    private static readonly IReadOnlyDictionary<string, string> EditorFontFamilyMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["黑体"] = "SimHei",
        ["微软雅黑"] = "Microsoft YaHei",
        ["宋体"] = "SimSun",
    };

    public IReadOnlyList<string> AvailableEditorFontFamilies { get; } = new[]
    {
        "黑体",
        "微软雅黑",
        "宋体",
    };

    public FontFamily EditorFontFamily => GetFontFamilyForName(EditorFontFamilyName);

    public IReadOnlyList<double> AvailableEditorFontSizes { get; } = new[]
    {
        10.0,
        12.0,
        14.0,
        16.0,
        18.0,
        20.0,
        22.0,
        24.0,
        26.0,
    };

    public ObservableCollection<string> RecentFolders { get; }

    public bool IsWorkspaceLoaded => !string.IsNullOrWhiteSpace(_workspacePath);

    public bool HasRecentFolders => RecentFolders.Count > 0;

    partial void OnEnableEditRestrictionChanged(bool value)
    {
        foreach (var document in OpenDocuments)
        {
            document.EditRestrictionEnabled = value;
        }

        OnPropertyChanged(nameof(ParserSummary));
    }

    partial void OnEnableTranslationModeChanged(bool value)
    {
        foreach (var document in OpenDocuments)
        {
            document.TranslationModeEnabled = value;
        }
    }

    partial void OnEditorFontFamilyNameChanged(string value)
    {
        var safeName = GetSafeFontFamilyName(value);
        var fontFamily = GetFontFamilyForName(safeName);

        if (OpenDocuments is not null)
        {
            foreach (var document in OpenDocuments)
            {
                document.ApplyEditorFontSettings(fontFamily, EditorFontSize);
            }
        }

        if (!string.Equals(EditorFontFamilyName, safeName, StringComparison.Ordinal))
        {
            EditorFontFamilyName = safeName;
            OnPropertyChanged(nameof(EditorFontFamily));
            return;
        }

        OnPropertyChanged(nameof(EditorFontFamily));
        SaveEditorSettings();
    }

    partial void OnEditorFontSizeChanged(double value)
    {
        if (OpenDocuments is not null)
        {
            foreach (var document in OpenDocuments)
            {
                document.ApplyEditorFontSettings(EditorFontFamily, value);
            }
        }

        SaveEditorSettings();
    }

    public MainWindowViewModel()
        : this(new EditorSettingsStore(), new RecentFoldersStore())
    {
    }

    public MainWindowViewModel(EditorSettingsStore settingsStore, RecentFoldersStore recentFoldersStore)
    {
        _settingsStore = settingsStore;
        _recentFoldersStore = recentFoldersStore;

        ParserConfig = new ParserConfig();
        RootNodes = new ObservableCollection<FileNodeViewModel>();
        OpenDocuments = new ObservableCollection<EditorDocumentViewModel>();
        OpenDocuments.CollectionChanged += OnOpenDocumentsChanged;

        var globalSettings = _settingsStore.LoadGlobalSettings();
        EditorFontFamilyName = GetSafeFontFamilyName(globalSettings.EditorFontFamily);
        EditorFontSize = globalSettings.EditorFontSize;

        RecentFolders = new ObservableCollection<string>(_recentFoldersStore.LoadRecentFolders());
        RecentFolders.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasRecentFolders));
    }

    public ObservableCollection<FileNodeViewModel> RootNodes { get; }

    public ObservableCollection<EditorDocumentViewModel> OpenDocuments { get; }

    public ParserConfig ParserConfig { get; private set; }

    public string WorkspacePath => _workspacePath ?? string.Empty;

    public string WorkspaceName => string.IsNullOrWhiteSpace(_workspacePath) ? "未打开文件夹" : GetLeafFolderName(_workspacePath);

    public string WorkspaceLabel => $"工作区：{WorkspaceName}";

    public string SidebarTitle => string.IsNullOrWhiteSpace(_workspacePath) ? "文件浏览器" : $"文件浏览器 - {WorkspaceName}";

    public string SimpleTmSharedUrl => _simpleTmSharedUrl;

    public string WindowTitle => string.IsNullOrWhiteSpace(_workspacePath) ? "dltxt editor" : $"dltxt editor - {WorkspaceName}";

    public string ParserSummary
    {
        get
        {
            if (!ParserConfig.IsConfigured)
            {
                return "双行格式：未配置";
            }

            return EnableEditRestriction
                ? "双行格式：已启用"
                : "双行格式：已配置（非限制模式）";
        }
    }

    public bool HasOpenDocuments => OpenDocuments.Count > 0;

    public bool IsEditorEmpty => !HasOpenDocuments;

    public EditorDocumentViewModel? SelectedDocument
    {
        get => _selectedDocument;
        set => SetSelectedDocument(value, true);
    }

    public void ApplyParserConfig(ParserConfig parserConfig)
    {
        ParserConfig = parserConfig.Clone();
        _settingsStore.SaveParserConfig(_workspacePath, ParserConfig);
        foreach (var document in OpenDocuments)
        {
            document.ApplyParserConfig(ParserConfig);
        }

        OnPropertyChanged(nameof(ParserConfig));
        OnPropertyChanged(nameof(ParserSummary));
        StatusMessage = ParserConfig.IsConfigured
            ? EnableEditRestriction
                ? "双行格式已更新。"
                : "双行格式已更新，当前为非限制模式。"
            : "双行格式已关闭，当前文档恢复普通编辑。";
    }

    private void SaveEditorSettings()
    {
        var settings = _settingsStore.LoadGlobalSettings();
        settings.EditorFontFamily = EditorFontFamilyName;
        settings.EditorFontSize = EditorFontSize;
        _settingsStore.SaveGlobalSettings(settings);
    }

    public void LoadWorkspace(string folderPath)
    {
        SaveAll();
        DisposeDocuments();

        _workspacePath = folderPath;
        var settings = _settingsStore.LoadSettings(folderPath);
        ParserConfig = settings.ParserConfig.Clone();
        _simpleTmSharedUrl = settings.SimpleTmSharedUrl ?? string.Empty;
        AddRecentFolder(folderPath);
        RefreshWorkspaceNodes();

        SetSelectedDocument(null, false);
        RaiseShellPropertyChanges();
        OnPropertyChanged(nameof(ParserConfig));
        OnPropertyChanged(nameof(ParserSummary));
        StatusMessage = $"已打开文件夹：{folderPath}";
    }

    public void SetSimpleTmSharedUrl(string sharedUrl)
    {
        _simpleTmSharedUrl = sharedUrl?.Trim() ?? string.Empty;

        foreach (var document in OpenDocuments)
        {
            document.SimpleTmSharedUrl = _simpleTmSharedUrl;
        }

        if (string.IsNullOrWhiteSpace(_workspacePath))
        {
            StatusMessage = "请先打开工作区后再配置术语库地址。";
            return;
        }

        var settings = _settingsStore.LoadSettings(_workspacePath);
        settings.SimpleTmSharedUrl = _simpleTmSharedUrl;
        _settingsStore.SaveSettings(_workspacePath, settings);

        StatusMessage = string.IsNullOrWhiteSpace(_simpleTmSharedUrl)
            ? "已清除术语库地址。"
            : "已保存术语库地址。";
    }

    private void AddRecentFolder(string folderPath)
    {
        try
        {
            var normalizedPath = Path.GetFullPath(folderPath);
            for (var i = RecentFolders.Count - 1; i >= 0; i--)
            {
                if (string.Equals(RecentFolders[i], normalizedPath, StringComparison.OrdinalIgnoreCase))
                {
                    RecentFolders.RemoveAt(i);
                }
            }

            RecentFolders.Insert(0, normalizedPath);
            while (RecentFolders.Count > 10)
            {
                RecentFolders.RemoveAt(10);
            }

            _recentFoldersStore.SaveRecentFolders(RecentFolders);
            OnPropertyChanged(nameof(HasRecentFolders));
        }
        catch
        {
            // Ignore recent-folder persistence failures.
        }
    }

    public void RefreshWorkspaceNodes()
    {
        if (string.IsNullOrWhiteSpace(_workspacePath))
        {
            return;
        }

        RootNodes.Clear();
        foreach (var node in FileNodeViewModel.BuildChildren(_workspacePath))
        {
            RootNodes.Add(node);
        }
    }

    public FileNodeViewModel? CreateNewFile(string folderPath, out string? error)
    {
        error = null;
        try
        {
            if (!Directory.Exists(folderPath))
            {
                error = "目标文件夹不存在。";
                return null;
            }

            var fileName = "newfile.txt";
            var counter = 1;
            var newFilePath = Path.Combine(folderPath, fileName);
            while (File.Exists(newFilePath))
            {
                fileName = $"newfile{counter}.txt";
                newFilePath = Path.Combine(folderPath, fileName);
                counter++;
            }

            using (File.Create(newFilePath))
            {
            }

            var newNode = new FileNodeViewModel(newFilePath, false);
            if (!AddFileNode(folderPath, newNode))
            {
                if (string.Equals(folderPath, _workspacePath, StringComparison.OrdinalIgnoreCase))
                {
                    var firstFileIndex = RootNodes.TakeWhile(node => node.IsDirectory).Count();
                    var insertIndex = firstFileIndex;
                    var newFileName = Path.GetFileName(newNode.FullPath);
                    for (var i = firstFileIndex; i < RootNodes.Count; i++)
                    {
                        var existingName = Path.GetFileName(RootNodes[i].FullPath);
                        if (string.Compare(existingName, newFileName, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            insertIndex = i;
                            break;
                        }

                        insertIndex = i + 1;
                    }

                    RootNodes.Insert(insertIndex, newNode);
                    return newNode;
                }

                RefreshWorkspaceNodes();
                return null;
            }

            return newNode;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return null;
        }
    }

    private bool AddFileNode(string folderPath, FileNodeViewModel newNode)
    {
        var folderNode = FindNodeByPath(folderPath);
        if (folderNode is null)
        {
            return false;
        }

        var insertIndex = folderNode.Children.TakeWhile(child => string.Compare(Path.GetFileName(child.FullPath), Path.GetFileName(newNode.FullPath), StringComparison.OrdinalIgnoreCase) < 0).Count();
        folderNode.Children.Insert(insertIndex, newNode);
        return true;
    }

    private FileNodeViewModel? FindNodeByPath(string path)
    {
        foreach (var node in RootNodes)
        {
            var found = FindNodeByPathRecursive(node, path);
            if (found is not null)
            {
                return found;
            }
        }

        return null;
    }

    private static FileNodeViewModel? FindNodeByPathRecursive(FileNodeViewModel node, string path)
    {
        if (string.Equals(node.FullPath, path, StringComparison.OrdinalIgnoreCase))
        {
            return node;
        }

        foreach (var child in node.Children)
        {
            var found = FindNodeByPathRecursive(child, path);
            if (found is not null)
            {
                return found;
            }
        }

        return null;
    }

    public void ResetAllRenameStates()
    {
        foreach (var root in RootNodes)
        {
            ResetRenameStatesRecursive(root);
        }
    }

    private static void ResetRenameStatesRecursive(FileNodeViewModel node)
    {
        node.ResetRenaming();
        foreach (var child in node.Children)
        {
            ResetRenameStatesRecursive(child);
        }
    }

    public void RenameFile(string originalPath, string newName, out string? error)
    {
        error = null;
        try
        {
            if (!File.Exists(originalPath))
            {
                error = "原始文件不存在。";
                return;
            }

            if (string.IsNullOrWhiteSpace(newName))
            {
                error = "文件名不能为空。";
                return;
            }

            var directory = Path.GetDirectoryName(originalPath);
            if (string.IsNullOrWhiteSpace(directory))
            {
                error = "无法解析文件目录。";
                return;
            }

            var newPath = Path.Combine(directory, newName);
            if (string.Equals(newPath, originalPath, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            if (File.Exists(newPath) || Directory.Exists(newPath))
            {
                error = "目标文件名已存在。";
                return;
            }

            File.Move(originalPath, newPath);

            var comparer = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            var document = OpenDocuments.FirstOrDefault(d => string.Equals(d.FilePath, originalPath, comparer));
            if (document is not null)
            {
                document.UpdateFilePath(newPath);
            }

            if (!UpdateNodePath(originalPath, newPath))
            {
                RefreshWorkspaceNodes();
            }
        }
        catch (Exception exception)
        {
            error = exception.Message;
        }
    }

    private bool UpdateNodePath(string originalPath, string newPath)
    {
        var node = FindNodeByPath(originalPath);
        if (node is null)
        {
            return false;
        }

        var parentPath = Path.GetDirectoryName(originalPath) ?? string.Empty;
        ObservableCollection<FileNodeViewModel> siblings;
        if (string.Equals(parentPath, _workspacePath, StringComparison.OrdinalIgnoreCase))
        {
            siblings = RootNodes;
        }
        else
        {
            var parentNode = FindNodeByPath(parentPath);
            if (parentNode is null)
            {
                siblings = RootNodes;
            }
            else
            {
                siblings = parentNode.Children;
            }
        }

        if (!siblings.Remove(node))
        {
            return false;
        }

        node.UpdatePath(newPath);
        var insertIndex = siblings.TakeWhile(child => string.Compare(Path.GetFileName(child.FullPath), Path.GetFileName(newPath), StringComparison.OrdinalIgnoreCase) < 0).Count();
        siblings.Insert(insertIndex, node);
        return true;
    }

    private bool RemoveNodeByPath(string path)
    {
        foreach (var root in RootNodes)
        {
            if (string.Equals(root.FullPath, path, StringComparison.OrdinalIgnoreCase))
            {
                return RootNodes.Remove(root);
            }

            if (RemoveNodeByPathRecursive(root.Children, path))
            {
                return true;
            }
        }

        return false;
    }

    private static bool RemoveNodeByPathRecursive(ObservableCollection<FileNodeViewModel> nodes, string path)
    {
        for (var i = 0; i < nodes.Count; i++)
        {
            if (string.Equals(nodes[i].FullPath, path, StringComparison.OrdinalIgnoreCase))
            {
                nodes.RemoveAt(i);
                return true;
            }

            if (RemoveNodeByPathRecursive(nodes[i].Children, path))
            {
                return true;
            }
        }

        return false;
    }

    public void DeletePath(string path, out string? error)
    {
        error = null;
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
            else if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
            }
            else
            {
                error = "目标路径不存在。";
                return;
            }

            var comparer = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            var documentsToClose = OpenDocuments
                .Where(document => IsPathUnder(document.FilePath, path, comparer))
                .ToList();

            foreach (var document in documentsToClose)
            {
                if (ReferenceEquals(document, _selectedDocument))
                {
                    SetSelectedDocument(null, false);
                }

                OpenDocuments.Remove(document);
                document.Dispose();
            }

            if (!RemoveNodeByPath(path))
            {
                RefreshWorkspaceNodes();
            }
        }
        catch (Exception exception)
        {
            error = exception.Message;
        }
    }

    private static bool IsPathUnder(string path, string parentPath, StringComparison comparison)
    {
        var normalizedPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var normalizedParent = Path.GetFullPath(parentPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

        if (string.Equals(normalizedPath, normalizedParent, comparison))
        {
            return true;
        }

        return normalizedPath.StartsWith(normalizedParent + Path.DirectorySeparatorChar, comparison)
            || normalizedPath.StartsWith(normalizedParent + Path.AltDirectorySeparatorChar, comparison);
    }

    public void OpenFile(string filePath)
    {
        if (!File.Exists(filePath))
        {
            StatusMessage = $"文件不存在：{filePath}";
            return;
        }

        var comparer = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        var existingDocument = OpenDocuments.FirstOrDefault(document => string.Equals(document.FilePath, filePath, comparer));
        if (existingDocument is not null)
        {
            SetSelectedDocument(existingDocument, true);
            return;
        }

        try
        {
            var content = File.ReadAllText(filePath);
            var document = new EditorDocumentViewModel(filePath, content, ParserConfig, CloseDocumentInternal)
            {
                EditRestrictionEnabled = EnableEditRestriction,
                TranslationModeEnabled = EnableTranslationMode,
                SimpleTmSharedUrl = _simpleTmSharedUrl,
            };
            document.ApplyEditorFontSettings(EditorFontFamily, EditorFontSize);
            OpenDocuments.Add(document);
            SetSelectedDocument(document, true);
            StatusMessage = $"已打开文件：{filePath}";
        }
        catch (Exception exception)
        {
            StatusMessage = $"打开文件失败：{exception.Message}";
        }
    }

    public void SaveAll()
    {
        string? firstError = null;
        foreach (var document in OpenDocuments)
        {
            if (!document.SaveIfDirty(out var error) && firstError is null)
            {
                firstError = $"{document.DisplayName}: {error}";
            }
        }

        if (!string.IsNullOrWhiteSpace(firstError))
        {
            StatusMessage = $"保存失败：{firstError}";
        }
    }

    public void SetStatus(string status)
    {
        StatusMessage = status;
    }

    [RelayCommand]
    private void SaveSelected()
    {
        if (SelectedDocument is null)
        {
            return;
        }

        if (SelectedDocument.Save(out var error))
        {
            StatusMessage = $"已保存：{SelectedDocument.FilePath}";
        }
        else
        {
            StatusMessage = $"保存失败：{error}";
        }
    }

    [RelayCommand]
    private void UndoSelected()
    {
        SelectedDocument?.Undo();
    }

    [RelayCommand]
    private void RedoSelected()
    {
        SelectedDocument?.Redo();
    }

    private void CloseDocumentInternal(EditorDocumentViewModel document)
    {
        if (!document.SaveIfDirty(out var error))
        {
            StatusMessage = $"关闭前保存失败：{document.DisplayName} - {error}";
        }

        var removedIndex = OpenDocuments.IndexOf(document);
        if (removedIndex < 0)
        {
            return;
        }

        var wasSelected = ReferenceEquals(document, _selectedDocument);
        if (wasSelected)
        {
            SetSelectedDocument(null, false);
        }

        OpenDocuments.RemoveAt(removedIndex);
        document.Dispose();

        if (wasSelected && OpenDocuments.Count > 0)
        {
            var nextIndex = Math.Clamp(removedIndex, 0, OpenDocuments.Count - 1);
            SetSelectedDocument(OpenDocuments[nextIndex], false);
        }
    }

    private void DisposeDocuments()
    {
        foreach (var document in OpenDocuments.ToArray())
        {
            document.Dispose();
        }

        OpenDocuments.Clear();
    }

    private void OnOpenDocumentsChanged(object? sender, NotifyCollectionChangedEventArgs eventArgs)
    {
        OnPropertyChanged(nameof(HasOpenDocuments));
        OnPropertyChanged(nameof(IsEditorEmpty));
    }

    private void SetSelectedDocument(EditorDocumentViewModel? nextDocument, bool autoSaveCurrent)
    {
        if (ReferenceEquals(_selectedDocument, nextDocument))
        {
            return;
        }

        if (autoSaveCurrent && _selectedDocument is not null && !_selectedDocument.SaveIfDirty(out var error))
        {
            StatusMessage = $"切换标签时保存失败：{_selectedDocument.DisplayName} - {error}";
        }

        _selectedDocument = nextDocument;
        OnPropertyChanged(nameof(SelectedDocument));
    }

    private void RaiseShellPropertyChanges()
    {
        OnPropertyChanged(nameof(WorkspacePath));
        OnPropertyChanged(nameof(WorkspaceName));
        OnPropertyChanged(nameof(WorkspaceLabel));
        OnPropertyChanged(nameof(SidebarTitle));
        OnPropertyChanged(nameof(WindowTitle));
        OnPropertyChanged(nameof(IsWorkspaceLoaded));
    }

    private static string GetSafeFontFamilyName(string fontFamilyName)
    {
        if (string.IsNullOrWhiteSpace(fontFamilyName))
        {
            return "黑体";
        }

        if (EditorFontFamilyMap.ContainsKey(fontFamilyName))
        {
            return fontFamilyName;
        }

        return "黑体";
    }

    private static FontFamily GetFontFamilyForName(string fontFamilyName)
    {
        if (!EditorFontFamilyMap.TryGetValue(fontFamilyName, out var actualName))
        {
            actualName = "SimHei";
        }

        try
        {
            return new FontFamily(actualName);
        }
        catch
        {
            return new FontFamily("Microsoft YaHei");
        }
    }

    private static string GetLeafFolderName(string path)
    {
        var trimmedPath = path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var folderName = Path.GetFileName(trimmedPath);
        return string.IsNullOrWhiteSpace(folderName) ? trimmedPath : folderName;
    }
}
