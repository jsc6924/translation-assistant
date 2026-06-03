using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using editor.Models;
using editor.Services;
using editor.ViewModels;

namespace editor.Views;

public partial class MainView : UserControl
{
    private readonly DispatcherTimer _autoSaveTimer;

    public MainView()
    {
        InitializeComponent();

        _autoSaveTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(30),
        };
        _autoSaveTimer.Tick += OnAutoSaveTimerTick;
        _autoSaveTimer.Start();

        DetachedFromVisualTree += (_, _) =>
        {
            _autoSaveTimer.Stop();

            if (DataContext is MainWindowViewModel viewModel)
            {
                viewModel.SaveSelectedIfDirty(out _);
                viewModel.SaveWorkspaceTabState();
            }
        };
    }

    private async void OnConfigureFormatClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (GetDialogOwner() is not { } owner)
        {
            viewModel.SetStatus("当前平台暂不支持此弹窗操作。");
            return;
        }

        var dialog = new ParserSettingsWindow(viewModel.ParserConfig);
        await dialog.ShowDialog(owner);
        if (dialog.ResultConfig is ParserConfig parserConfig)
        {
            viewModel.ApplyParserConfig(parserConfig);
        }
    }

    private void OnAutoDetectFormatClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (viewModel.SelectedDocument is null)
        {
            viewModel.SetStatus("请先打开一个文本文件以自动识别双行格式。");
            return;
        }

        var text = viewModel.SelectedDocument.Document.Text;
        if (!ParserConfigDetector.TryDetect(text, out var parserConfig, out var error))
        {
            viewModel.SetStatus($"自动识别失败：{error}");
            return;
        }

        viewModel.ApplyParserConfig(parserConfig);
        viewModel.SetStatus("已自动识别双行格式并应用到当前工作区。");
    }

    private async void OnConfigureSimpleTmClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (GetDialogOwner() is not { } owner)
        {
            viewModel.SetStatus("当前平台暂不支持此弹窗操作。");
            return;
        }

        var dialog = new SimpleTmSettingsWindow(viewModel.SimpleTmSharedUrl, viewModel);
        var confirmed = await dialog.ShowDialog<bool?>(owner) ?? false;
        if (!confirmed)
        {
            return;
        }

        viewModel.SetSimpleTmSharedUrl(dialog.SharedUrl);
    }

    private async void OnConfigureBackgroundClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (GetDialogOwner() is not { } owner)
        {
            viewModel.SetStatus("当前平台暂不支持此弹窗操作。");
            return;
        }

        var currentBackgroundPath = string.IsNullOrWhiteSpace(viewModel.BackgroundImageFileName)
            ? string.Empty
            : EditorSettingsStore.GetGlobalSettingsDirectory() is { } dir
                ? Path.Combine(dir, viewModel.BackgroundImageFileName)
                : string.Empty;

        var dialog = new BackgroundSettingsWindow(currentBackgroundPath, viewModel.BackgroundImageOpacity, viewModel.BackgroundImageFillMode);
        var confirmed = await dialog.ShowDialog<bool?>(owner) ?? false;
        if (!confirmed)
        {
            return;
        }

        viewModel.SetEditorBackgroundImage(dialog.SelectedImagePath, dialog.SelectedOpacity, dialog.SelectedFillMode);
    }

    private void OnAutoSaveTimerTick(object? sender, EventArgs e)
    {
        if (DataContext is MainWindowViewModel viewModel)
        {
            viewModel.SaveSelectedIfDirty(out var error);
            if (!string.IsNullOrWhiteSpace(error))
            {
                viewModel.SetStatus($"自动保存失败：{error}");
            }
        }
    }

    private void OnFileTreeSelectionChanged(object? sender, SelectionChangedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        foreach (var item in eventArgs.AddedItems)
        {
            if (item is FileNodeViewModel node)
            {
                if (node.IsDirectory)
                {
                    node.IsExpanded = !node.IsExpanded;
                }
                else
                {
                    viewModel.OpenFile(node.FullPath);
                    ShowEditorTab();
                }

                break;
            }
        }
    }

    private async void OnOpenFolderClick(object? sender, RoutedEventArgs eventArgs)
    {
        await PickFolderAndLoadAsync(false);
    }

    private void OnOpenWorkspaceInExplorerClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var folderPath = viewModel.WorkspacePath;
        if (string.IsNullOrWhiteSpace(folderPath) || !Directory.Exists(folderPath))
        {
            viewModel.SetStatus("当前没有打开可用的工作区文件夹。");
            return;
        }

        try
        {
            var path = Path.GetFullPath(folderPath);
            var startInfo = new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = true,
                Verb = "open",
            };

            Process.Start(startInfo);
        }
        catch (Exception exception)
        {
            viewModel.SetStatus($"无法打开系统文件管理器：{exception.Message}");
        }
    }

    private void OnRefreshWorkspaceClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        viewModel.RefreshWorkspace();
    }

    private async void OnSaveAsClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (viewModel.SelectedDocument is null)
        {
            viewModel.SetStatus("请先选择一个文档进行另存为。");
            return;
        }

        var storageProvider = GetStorageProvider();
        if (storageProvider is null)
        {
            viewModel.SetStatus("当前平台不支持另存为操作。请在桌面环境中使用。");
            return;
        }

        var currentFilePath = viewModel.SelectedDocument.FilePath;
        var defaultFileName = Path.GetFileName(currentFilePath);

        IStorageFolder? startLocation = null;
        try
        {
            var currentDirectory = Path.GetDirectoryName(currentFilePath);
            if (!string.IsNullOrWhiteSpace(currentDirectory) && Directory.Exists(currentDirectory))
            {
                startLocation = await storageProvider.TryGetFolderFromPathAsync(currentDirectory);
            }
        }
        catch
        {
        }

        var options = new FilePickerSaveOptions
        {
            Title = "请选择另存为目标文件",
            DefaultExtension = Path.GetExtension(defaultFileName),
            SuggestedFileName = defaultFileName,
            SuggestedStartLocation = startLocation,
        };

        var file = await storageProvider.SaveFilePickerAsync(options);
        if (file is null)
        {
            return;
        }

        var targetPath = file.TryGetLocalPath();
        if (string.IsNullOrWhiteSpace(targetPath))
        {
            viewModel.SetStatus("另存为失败：无法获得本地文件路径。");
            return;
        }

        if (viewModel.SaveSelectedAs(targetPath, out var error))
        {
            viewModel.SetStatus($"已另存为：{targetPath}");
        }
        else
        {
            viewModel.SetStatus($"另存为失败：{error}");
        }
    }

    private async void OnReloadWithEncodingClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (viewModel.SelectedDocument is null)
        {
            viewModel.SetStatus("请先选择一个要重新加载的文件。");
            return;
        }

        if (GetDialogOwner() is not { } owner)
        {
            viewModel.SetStatus("当前平台暂不支持此弹窗操作。");
            return;
        }

        var dialog = new ReloadEncodingWindow(viewModel.SelectedDocument.EncodingName);
        var confirmed = await dialog.ShowDialog<bool?>(owner) ?? false;
        if (!confirmed)
        {
            return;
        }

        viewModel.ReloadSelectedDocumentWithEncoding(dialog.SelectedEncoding);
    }

    private void OnOpenRecentFolderClick(object? sender, RoutedEventArgs eventArgs)
    {
        string? folderPath = null;
        if (sender is Button button && button.DataContext is string buttonPath)
        {
            folderPath = buttonPath;
        }
        else if (sender is MenuItem menuItem && menuItem.DataContext is string menuPath)
        {
            folderPath = menuPath;
        }

        if (string.IsNullOrWhiteSpace(folderPath))
        {
            return;
        }

        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (!Directory.Exists(folderPath))
        {
            viewModel.SetStatus($"最近文件夹不存在：{folderPath}");
            return;
        }

        if (TryLoadWorkspace(viewModel, folderPath))
        {
            ShowFilesTab();
        }
    }

    private void OnCreateFileClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (sender is not MenuItem menuItem || menuItem.DataContext is not FileNodeViewModel node || !node.IsDirectory)
        {
            return;
        }

        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var newNode = viewModel.CreateNewFile(node.FullPath, out var error);
        if (error is not null)
        {
            viewModel.SetStatus($"创建文件失败：{error}");
            return;
        }

        if (newNode is not null)
        {
            FileTree.SelectedItem = newNode;
            viewModel.OpenFile(newNode.FullPath);
            ShowEditorTab();
        }

        viewModel.SetStatus($"已创建新文件：{node.FullPath}");
    }

    private async void OnDeleteNodeClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (sender is not MenuItem menuItem || menuItem.DataContext is not FileNodeViewModel node)
        {
            return;
        }

        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (GetDialogOwner() is not { } owner)
        {
            viewModel.SetStatus("当前平台暂不支持此弹窗操作。");
            return;
        }

        var target = node.IsDirectory ? "文件夹" : "文件";
        var dialog = new ConfirmDialog($"确认删除 {target}：{node.DisplayName}？\n此操作无法撤销。");
        var confirmed = await dialog.ShowDialog<bool?>(owner) ?? false;
        if (!confirmed)
        {
            return;
        }

        viewModel.DeletePath(node.FullPath, out var error);
        if (error is not null)
        {
            viewModel.SetStatus($"删除失败：{error}");
            return;
        }

        viewModel.SetStatus($"已删除：{node.FullPath}");
    }

    private void OnRenameNodeClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (sender is not MenuItem menuItem || menuItem.DataContext is not FileNodeViewModel node || node.IsDirectory)
        {
            return;
        }

        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        viewModel.ResetAllRenameStates();
        node.BeginRename();
        viewModel.SetStatus($"正在重命名：{node.DisplayName}");
    }

    private void OnRenameTextBoxKeyDown(object? sender, KeyEventArgs e)
    {
        if (sender is not TextBox textBox || textBox.DataContext is not FileNodeViewModel node)
        {
            return;
        }

        if (e.Key == Key.Enter || e.Key == Key.Return)
        {
            CommitRename(node);
            e.Handled = true;
        }
        else if (e.Key == Key.Escape)
        {
            node.ResetRenaming();
            e.Handled = true;
        }
    }

    private void OnRenameTextBoxLostFocus(object? sender, FocusChangedEventArgs e)
    {
        if (sender is not TextBox textBox || textBox.DataContext is not FileNodeViewModel node)
        {
            return;
        }

        if (!node.IsRenaming)
        {
            return;
        }

        CommitRename(node);
    }

    private void OnHelpShortcutClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (GetDialogOwner() is not { } owner)
        {
            if (DataContext is MainWindowViewModel viewModel)
            {
                viewModel.SetStatus("当前平台暂不支持此弹窗操作。");
            }

            return;
        }

        var dialog = new HelpShortcutDialog();
        _ = dialog.ShowDialog(owner);
    }

    private void OnAboutClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (GetDialogOwner() is not { } owner)
        {
            if (DataContext is MainWindowViewModel viewModel)
            {
                viewModel.SetStatus("当前平台暂不支持此弹窗操作。");
            }

            return;
        }

        var dialog = new AboutDialog();
        _ = dialog.ShowDialog(owner);
    }

    private void OnCreateNewFileClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var folderPath = viewModel.WorkspacePath;
        if (string.IsNullOrWhiteSpace(folderPath))
        {
            viewModel.SetStatus("请先打开一个工作区，再创建新文件。");
            return;
        }

        var newNode = viewModel.CreateNewFile(folderPath, out var error);
        if (error is not null)
        {
            viewModel.SetStatus($"创建文件失败：{error}");
            return;
        }

        if (newNode is not null)
        {
            FileTree.SelectedItem = newNode;
            viewModel.OpenFile(newNode.FullPath);
            ShowEditorTab();
            viewModel.SetStatus($"已创建并打开新文件：{newNode.FullPath}");
        }
    }

    private void CommitRename(FileNodeViewModel node)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        viewModel.RenameFile(node.FullPath, node.RenameText, out var error);
        if (error is not null)
        {
            viewModel.SetStatus($"重命名失败：{error}");
            return;
        }

        node.ResetRenaming();
        viewModel.SetStatus($"已重命名：{node.RenameText}");
    }

    private void OnTreeViewItemPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (e.GetCurrentPoint(this).Properties.IsRightButtonPressed)
        {
            return;
        }

        if (sender is not Control control)
        {
            return;
        }

        if (e.GetCurrentPoint(control).Properties.IsLeftButtonPressed)
        {
            var treeViewItem = control.GetSelfAndVisualAncestors().OfType<TreeViewItem>().FirstOrDefault();
            if (treeViewItem is not null && treeViewItem.DataContext is FileNodeViewModel node && node.IsDirectory)
            {
                treeViewItem.IsExpanded = !treeViewItem.IsExpanded;
                e.Handled = true;
            }
        }
    }

    private async Task<bool> PickFolderAndLoadAsync(bool requireSelection)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return false;
        }

        var storageProvider = GetStorageProvider();
        if (storageProvider is null || !storageProvider.CanPickFolder)
        {
            viewModel.SetStatus("当前平台不支持文件夹选择。请改用支持文件系统访问的桌面环境。");
            return !requireSelection;
        }

        var folders = await storageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
        {
            Title = "选择翻译项目文件夹",
            AllowMultiple = false,
        });

        var folder = folders.FirstOrDefault();
        if (folder is null)
        {
            if (requireSelection)
            {
                viewModel.SetStatus("未选择文件夹。应用将退出。");
            }

            return !requireSelection;
        }

        var path = ResolveFolderPath(folder);
        if (string.IsNullOrWhiteSpace(path))
        {
            viewModel.SetStatus("所选文件夹无法映射到本地路径。请重新选择。");
            return !requireSelection;
        }

        if (!TryLoadWorkspace(viewModel, path))
        {
            return !requireSelection;
        }

        if (viewModel.HasOpenDocuments)
        {
            ShowEditorTab();
        }
        else
        {
            ShowFilesTab();
        }

        return true;
    }

    private static bool TryLoadWorkspace(MainWindowViewModel viewModel, string path)
    {
        try
        {
            viewModel.LoadWorkspace(path);
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            viewModel.SetStatus("当前 Android 权限不允许直接写入该共享文件夹。后续需要改成专门的 Android 文档访问模式。当前已阻止闪退。");
            return false;
        }
        catch (Exception exception)
        {
            viewModel.SetStatus($"打开文件夹失败：{exception.Message}");
            return false;
        }
    }

    private static string? ResolveFolderPath(IStorageFolder folder)
    {
        var localPath = folder.TryGetLocalPath();
        if (!string.IsNullOrWhiteSpace(localPath))
        {
            return localPath;
        }

        return TryMapAndroidDocumentTreePath(folder.Path);
    }

    private static string? TryMapAndroidDocumentTreePath(Uri? folderUri)
    {
        if (folderUri is null ||
            !folderUri.IsAbsoluteUri ||
            !string.Equals(folderUri.Scheme, "content", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var absoluteUri = folderUri.AbsoluteUri;
        if (!absoluteUri.Contains("com.android.externalstorage.documents", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var markerIndex = absoluteUri.IndexOf("/tree/", StringComparison.OrdinalIgnoreCase);
        var markerLength = 6;
        if (markerIndex < 0)
        {
            markerIndex = absoluteUri.IndexOf("/document/", StringComparison.OrdinalIgnoreCase);
            markerLength = 10;
        }

        if (markerIndex < 0)
        {
            return null;
        }

        var documentIdStart = markerIndex + markerLength;
        if (documentIdStart >= absoluteUri.Length)
        {
            return null;
        }

        var documentIdEnd = absoluteUri.IndexOf("/document/", documentIdStart, StringComparison.OrdinalIgnoreCase);
        if (documentIdEnd < 0)
        {
            documentIdEnd = absoluteUri.IndexOf('?', documentIdStart);
        }

        var documentId = documentIdEnd >= 0
            ? absoluteUri.Substring(documentIdStart, documentIdEnd - documentIdStart)
            : absoluteUri[documentIdStart..];
        documentId = Uri.UnescapeDataString(documentId);

        if (string.IsNullOrWhiteSpace(documentId))
        {
            return null;
        }

        if (documentId.StartsWith("raw:", StringComparison.OrdinalIgnoreCase))
        {
            return documentId[4..];
        }

        const string primaryPrefix = "primary:";
        if (!documentId.StartsWith(primaryPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var relativePath = documentId[primaryPrefix.Length..]
            .Replace('/', Path.DirectorySeparatorChar)
            .TrimStart(Path.DirectorySeparatorChar);
        var sharedStorageRoot = Path.Combine(Path.DirectorySeparatorChar.ToString(), "storage", "emulated", "0");

        return string.IsNullOrWhiteSpace(relativePath)
            ? sharedStorageRoot
            : Path.Combine(sharedStorageRoot, relativePath);
    }

    private void ShowFilesTab()
    {
        MobileWorkspaceTabs.SelectedIndex = 0;
    }

    private void ShowEditorTab()
    {
        MobileWorkspaceTabs.SelectedIndex = 1;
    }

    private Window? GetDialogOwner()
    {
        return TopLevel.GetTopLevel(this) as Window;
    }

    private IStorageProvider? GetStorageProvider()
    {
        return TopLevel.GetTopLevel(this)?.StorageProvider;
    }
}