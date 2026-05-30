using System;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.IO;
using System.Linq;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using editor.Models;
using editor.Services;

namespace editor.ViewModels;

public partial class MainWindowViewModel : ViewModelBase
{
    private readonly EditorSettingsStore _settingsStore;
    private EditorDocumentViewModel? _selectedDocument;
    private string? _workspacePath;

    [ObservableProperty]
    private string _statusMessage = "请选择一个文件夹开始。";

    [ObservableProperty]
    private bool _enableEditRestriction = true;

    partial void OnEnableEditRestrictionChanged(bool value)
    {
        foreach (var document in OpenDocuments)
        {
            document.EditRestrictionEnabled = value;
        }

        OnPropertyChanged(nameof(ParserSummary));
    }

    public MainWindowViewModel()
        : this(new EditorSettingsStore())
    {
    }

    public MainWindowViewModel(EditorSettingsStore settingsStore)
    {
        _settingsStore = settingsStore;
        ParserConfig = new ParserConfig();
        RootNodes = new ObservableCollection<FileNodeViewModel>();
        OpenDocuments = new ObservableCollection<EditorDocumentViewModel>();
        OpenDocuments.CollectionChanged += OnOpenDocumentsChanged;
    }

    public ObservableCollection<FileNodeViewModel> RootNodes { get; }

    public ObservableCollection<EditorDocumentViewModel> OpenDocuments { get; }

    public ParserConfig ParserConfig { get; private set; }

    public string WorkspacePath => _workspacePath ?? string.Empty;

    public string WorkspaceName => string.IsNullOrWhiteSpace(_workspacePath) ? "未打开文件夹" : GetLeafFolderName(_workspacePath);

    public string WorkspaceLabel => $"工作区：{WorkspaceName}";

    public string SidebarTitle => string.IsNullOrWhiteSpace(_workspacePath) ? "文件浏览器" : $"文件浏览器 - {WorkspaceName}";

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

    public void LoadWorkspace(string folderPath)
    {
        SaveAll();
        DisposeDocuments();

        _workspacePath = folderPath;
        ParserConfig = _settingsStore.LoadParserConfig(folderPath);
        RootNodes.Clear();
        foreach (var node in FileNodeViewModel.BuildChildren(folderPath))
        {
            RootNodes.Add(node);
        }

        SetSelectedDocument(null, false);
        RaiseShellPropertyChanges();
        OnPropertyChanged(nameof(ParserConfig));
        OnPropertyChanged(nameof(ParserSummary));
        StatusMessage = $"已打开文件夹：{folderPath}";
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
            };
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
    }

    private static string GetLeafFolderName(string path)
    {
        var trimmedPath = path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var folderName = Path.GetFileName(trimmedPath);
        return string.IsNullOrWhiteSpace(folderName) ? trimmedPath : folderName;
    }
}
