using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using CommunityToolkit.Mvvm.ComponentModel;
using editor.Models;
using editor.Services;
using editor.ViewModels;

namespace editor.Views;

public partial class MainView : UserControl
{
    private const string VsCodeDownloadUrl = "https://code.visualstudio.com/download";
    private const string DltxtProjectUrl = "https://github.com/jsc6924/translation-assistant";

    private readonly DispatcherTimer _autoSaveTimer;
    private readonly SimpleTmRemoteClient _simpleTmRemoteClient = new();
    private readonly ParserSettingsViewModel _mobileParserSettingsViewModel = new();
    private readonly BackgroundSettingsViewModel _mobileBackgroundSettingsViewModel = new(string.Empty, 0.5, false);
    private readonly MobileSimpleTmState _mobileSimpleTmState = new();
    private readonly MobileReloadEncodingState _mobileReloadEncodingState = new();
    private readonly MobileConfirmState _mobileConfirmState = new();
    private readonly MobileAboutState _mobileAboutState = new();
    private bool _isMobileMenuOpen;
    private MobileModalKind _activeMobileModal;
    private Action? _mobileConfirmAction;

    public MainView()
    {
        InitializeComponent();

        ParserSettingsModal.DataContext = _mobileParserSettingsViewModel;
        SimpleTmSettingsModal.DataContext = _mobileSimpleTmState;
        BackgroundSettingsModal.DataContext = _mobileBackgroundSettingsViewModel;
        ReloadEncodingModal.DataContext = _mobileReloadEncodingState;
        ConfirmModal.DataContext = _mobileConfirmState;
        AboutModal.DataContext = _mobileAboutState;
        UpdateMobileMenuVisibility();
        UpdateMobileModalVisibility();

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

    public void StartMobileUpdateCheck(string currentVersionText, string latestVersionUrl, string releasesUrl)
    {
        _ = CheckForUpdatesOnMobileAsync(currentVersionText, latestVersionUrl, releasesUrl);
    }

    private async Task CheckForUpdatesOnMobileAsync(string currentVersionText, string latestVersionUrl, string releasesUrl)
    {
        try
        {
            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(10),
            };

            var remoteText = await httpClient.GetStringAsync(latestVersionUrl).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(remoteText))
            {
                return;
            }

            var latestVersionText = remoteText.Trim();
            var currentVersion = ParseVersionSegments(currentVersionText);
            var latestVersion = ParseVersionSegments(latestVersionText);
            if (currentVersion is null || latestVersion is null)
            {
                return;
            }

            if (!IsLatestVersionNewer(currentVersion, latestVersion))
            {
                return;
            }

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                _mobileConfirmState.Message = $"检测到新版本 {latestVersionText}，是否前往 Releases 下载？";
                _mobileConfirmState.ConfirmButtonText = "前往下载";
                _mobileConfirmAction = () => OpenUrl(releasesUrl);
                OpenMobileModal(MobileModalKind.Confirm, "版本更新");
            });
        }
        catch
        {
            // Ignore update check failures.
        }
    }

    private static int[]? ParseVersionSegments(string versionText)
    {
        var parts = versionText.Split('.');
        if (parts.Length != 3)
        {
            return null;
        }

        var segments = new int[3];
        for (var i = 0; i < 3; i++)
        {
            if (!int.TryParse(parts[i], out var value) || value < 0)
            {
                return null;
            }

            segments[i] = value;
        }

        return segments;
    }

    private static bool IsLatestVersionNewer(int[] currentVersion, int[] latestVersion)
    {
        for (var i = 0; i < 3; i++)
        {
            if (currentVersion[i] < latestVersion[i])
            {
                return true;
            }

            if (currentVersion[i] > latestVersion[i])
            {
                return false;
            }
        }

        return false;
    }

    private void OnConfigureFormatClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        LoadParserConfig(viewModel.ParserConfig);
        OpenMobileModal(MobileModalKind.ParserSettings, "双行格式");
    }

    private void OnAutoDetectFormatClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
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

    private void OnConfigureSimpleTmClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        _mobileSimpleTmState.SharedUrl = viewModel.SimpleTmSharedUrl;
        _mobileSimpleTmState.PreviewBody = string.Empty;
        _mobileSimpleTmState.LoadedPreviewUrl = string.Empty;
        _mobileSimpleTmState.StatusMessage = string.IsNullOrWhiteSpace(_mobileSimpleTmState.SharedUrl)
            ? "请输入术语库 URL 后再刷新预览。"
            : "修改 URL 后可刷新预览并保存。";

        OpenMobileModal(MobileModalKind.SimpleTmSettings, "术语库配置");
    }

    private void OnConfigureBackgroundClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var currentBackgroundPath = string.IsNullOrWhiteSpace(viewModel.BackgroundImageFileName)
            ? string.Empty
            : EditorSettingsStore.GetGlobalSettingsDirectory() is { } dir
                ? Path.Combine(dir, viewModel.BackgroundImageFileName)
                : string.Empty;

        _mobileBackgroundSettingsViewModel.SelectedImagePath = currentBackgroundPath;
        _mobileBackgroundSettingsViewModel.BackgroundOpacity = viewModel.BackgroundImageOpacity;
        _mobileBackgroundSettingsViewModel.BackgroundFillMode = viewModel.BackgroundImageFillMode;
        _mobileBackgroundSettingsViewModel.StatusMessage = string.Empty;

        OpenMobileModal(MobileModalKind.BackgroundSettings, "背景设置");
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

    private void UpdateMobileMenuVisibility()
    {
        if (MobileActionMenu is not null)
        {
            MobileActionMenu.IsVisible = _isMobileMenuOpen;
        }

        if (MobileMenuOverlay is not null)
        {
            MobileMenuOverlay.IsVisible = _isMobileMenuOpen;
        }
    }

    private void CloseMobileMenu()
    {
        _isMobileMenuOpen = false;
        UpdateMobileMenuVisibility();
    }

    private void OnToggleMenuClick(object? sender, RoutedEventArgs eventArgs)
    {
        _isMobileMenuOpen = !_isMobileMenuOpen;
        UpdateMobileMenuVisibility();
    }

    private void OnCloseMenuClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
    }

    private void OnMobileMenuOverlayPointerPressed(object? sender, PointerPressedEventArgs eventArgs)
    {
        CloseMobileMenu();
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
        CloseMobileMenu();
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
        CloseMobileMenu();
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        viewModel.RefreshWorkspace();
    }

    private async void OnSaveAsClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
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

    private void OnReloadWithEncodingClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (viewModel.SelectedDocument is null)
        {
            viewModel.SetStatus("请先选择一个要重新加载的文件。");
            return;
        }

        _mobileReloadEncodingState.SetEncoding(viewModel.SelectedDocument.EncodingName);
        OpenMobileModal(MobileModalKind.ReloadEncoding, "重新加载编码");
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

    private void OnDeleteNodeClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (sender is not MenuItem menuItem || menuItem.DataContext is not FileNodeViewModel node)
        {
            return;
        }

        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var target = node.IsDirectory ? "文件夹" : "文件";
        var path = node.FullPath;
        _mobileConfirmState.Message = $"确认删除 {target}：{node.DisplayName}？\n此操作无法撤销。";
        _mobileConfirmState.ConfirmButtonText = node.IsDirectory ? "删除文件夹" : "删除文件";
        _mobileConfirmAction = () =>
        {
            viewModel.DeletePath(path, out var error);
            if (error is not null)
            {
                viewModel.SetStatus($"删除失败：{error}");
                return;
            }

            viewModel.SetStatus($"已删除：{path}");
        };

        OpenMobileModal(MobileModalKind.Confirm, "确认删除");
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
        CloseMobileMenu();
        OpenMobileModal(MobileModalKind.Help, "快捷键");
    }

    private void OnAboutClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
        OpenMobileModal(MobileModalKind.About, "关于");
    }

    private void OnCreateNewFileClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileMenu();
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

    private void OnCloseMobileModalClick(object? sender, RoutedEventArgs eventArgs)
    {
        CloseMobileModal();
    }

    private void OnSaveParserSettingsClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var parserConfig = _mobileParserSettingsViewModel.ToParserConfig();
        if (!DualLineDocumentParser.TryValidate(parserConfig, out var error))
        {
            _mobileParserSettingsViewModel.ValidationMessage = error ?? "双行格式无效。";
            return;
        }

        _mobileParserSettingsViewModel.ValidationMessage = string.Empty;
        viewModel.ApplyParserConfig(parserConfig);
        CloseMobileModal();
    }

    private async void OnRefreshSimpleTmPreviewClick(object? sender, RoutedEventArgs eventArgs)
    {
        await LoadMobileSimpleTmPreviewAsync();
        await SyncMobileRemoteVscodeConfigAsync();
    }

    private async void OnSaveSimpleTmSettingsClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        if (!string.Equals(_mobileSimpleTmState.LoadedPreviewUrl, _mobileSimpleTmState.SharedUrl, StringComparison.OrdinalIgnoreCase))
        {
            await LoadMobileSimpleTmPreviewAsync();
            return;
        }

        await SyncMobileRemoteVscodeConfigAsync();
        viewModel.SetSimpleTmSharedUrl(_mobileSimpleTmState.SharedUrl);
        CloseMobileModal();
    }

    private async void OnSelectBackgroundImageClick(object? sender, RoutedEventArgs eventArgs)
    {
        var storageProvider = GetStorageProvider();
        if (storageProvider is null)
        {
            return;
        }

        var fileTypes = new[]
        {
            new FilePickerFileType("Image")
            {
                Patterns = new[] { "*.png", "*.jpg", "*.jpeg", "*.bmp", "*.gif" },
            }
        };

        var files = await storageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "选择背景图片",
            AllowMultiple = false,
            FileTypeFilter = fileTypes,
        });

        var file = files.FirstOrDefault();
        try
        {
            using var stream = await file.OpenReadAsync();

            // 生成一个在 App 专属私有目录下的安全文件名（例如：C:\Users...\Appdata 或 Android 的 /data/user/0/包名/files）
            var cacheFolder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var safeFileName = "user_background" + Path.GetExtension(file.Name);
            var destinationPath = Path.Combine(cacheFolder, safeFileName);

            // 把选中的相册图片，复制到我们自己的私有目录
            using var targetStream = File.Create(destinationPath);
            await stream.CopyToAsync(targetStream);

            // 把我们自己拥有的、绝对有权访问的私有物理路径给 ViewModel
            _mobileBackgroundSettingsViewModel.SelectedImagePath = destinationPath;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Error Saving Background Image]: {ex.Message}");
            return;
        }
    }

    private void OnClearBackgroundImageClick(object? sender, RoutedEventArgs eventArgs)
    {
        _mobileBackgroundSettingsViewModel.SelectedImagePath = string.Empty;
    }

    private void OnSaveBackgroundSettingsClick(object? sender, RoutedEventArgs eventArgs)
    {
        Console.WriteLine($"[Background Settings] ImagePath: {_mobileBackgroundSettingsViewModel.SelectedImagePath}, Opacity: {_mobileBackgroundSettingsViewModel.BackgroundOpacity}, FillMode: {_mobileBackgroundSettingsViewModel.BackgroundFillMode}"); // --- IGNORE ---

        if (DataContext is not MainWindowViewModel viewModel)
        {
            Console.WriteLine("[Background Settings] Failed to apply background settings: MainWindowViewModel not found."); // --- IGNORE ---
            return;
        }

        viewModel.SetEditorBackgroundImage(
            _mobileBackgroundSettingsViewModel.SelectedImagePath,
            _mobileBackgroundSettingsViewModel.BackgroundOpacity,
            _mobileBackgroundSettingsViewModel.BackgroundFillMode);
        CloseMobileModal();
    }

    private void OnConfirmReloadEncodingClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel || viewModel.SelectedDocument is null)
        {
            return;
        }

        viewModel.ReloadSelectedDocumentWithEncoding(_mobileReloadEncodingState.SelectedEncoding);
        CloseMobileModal();
    }

    private void OnConfirmMobileActionClick(object? sender, RoutedEventArgs eventArgs)
    {
        var action = _mobileConfirmAction;
        CloseMobileModal();
        action?.Invoke();
    }

    private void OnAboutDownloadVsCodeClick(object? sender, RoutedEventArgs eventArgs)
    {
        OpenUrl(VsCodeDownloadUrl);
    }

    private void OnAboutViewDltxtClick(object? sender, RoutedEventArgs eventArgs)
    {
        OpenUrl(DltxtProjectUrl);
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

    private void LoadParserConfig(ParserConfig parserConfig)
    {
        var clonedConfig = parserConfig.Clone();
        _mobileParserSettingsViewModel.OriginalPrefixRegex = clonedConfig.OriginalPrefixRegex;
        _mobileParserSettingsViewModel.TranslatedPrefixRegex = clonedConfig.TranslatedPrefixRegex;
        _mobileParserSettingsViewModel.OriginalWhiteRegex = clonedConfig.OriginalWhiteRegex;
        _mobileParserSettingsViewModel.TranslatedWhiteRegex = clonedConfig.TranslatedWhiteRegex;
        _mobileParserSettingsViewModel.OriginalSuffixRegex = clonedConfig.OriginalSuffixRegex;
        _mobileParserSettingsViewModel.TranslatedSuffixRegex = clonedConfig.TranslatedSuffixRegex;
        _mobileParserSettingsViewModel.NameRegex = clonedConfig.NameRegex;
        _mobileParserSettingsViewModel.ValidationMessage = string.Empty;
    }

    private void OpenMobileModal(MobileModalKind modalKind, string title)
    {
        _activeMobileModal = modalKind;
        MobileModalTitleText.Text = title;
        UpdateMobileModalVisibility();
    }

    private void CloseMobileModal()
    {
        _activeMobileModal = MobileModalKind.None;
        _mobileConfirmAction = null;
        UpdateMobileModalVisibility();
    }

    private void UpdateMobileModalVisibility()
    {
        var isVisible = _activeMobileModal != MobileModalKind.None;
        MobileModalOverlay.IsVisible = isVisible;
        ParserSettingsModal.IsVisible = _activeMobileModal == MobileModalKind.ParserSettings;
        SimpleTmSettingsModal.IsVisible = _activeMobileModal == MobileModalKind.SimpleTmSettings;
        BackgroundSettingsModal.IsVisible = _activeMobileModal == MobileModalKind.BackgroundSettings;
        ReloadEncodingModal.IsVisible = _activeMobileModal == MobileModalKind.ReloadEncoding;
        ConfirmModal.IsVisible = _activeMobileModal == MobileModalKind.Confirm;
        HelpShortcutModal.IsVisible = _activeMobileModal == MobileModalKind.Help;
        AboutModal.IsVisible = _activeMobileModal == MobileModalKind.About;
    }

    private async Task LoadMobileSimpleTmPreviewAsync()
    {
        _mobileSimpleTmState.PreviewBody = string.Empty;
        _mobileSimpleTmState.StatusMessage = string.IsNullOrWhiteSpace(_mobileSimpleTmState.SharedUrl)
            ? "请输入术语库 URL 后再刷新预览。"
            : "正在从远程服务器加载术语预览...";

        if (string.IsNullOrWhiteSpace(_mobileSimpleTmState.SharedUrl))
        {
            _mobileSimpleTmState.LoadedPreviewUrl = string.Empty;
            return;
        }

        try
        {
            var previewResult = await _simpleTmRemoteClient.FetchTermsJsonAsync(_mobileSimpleTmState.SharedUrl).ConfigureAwait(false);
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                _mobileSimpleTmState.PreviewBody = previewResult;
                _mobileSimpleTmState.LoadedPreviewUrl = _mobileSimpleTmState.SharedUrl;
                _mobileSimpleTmState.StatusMessage = !string.IsNullOrWhiteSpace(previewResult)
                    ? "已加载术语 JSON 预览。再次点击保存即可完成保存。"
                    : "从远程服务器未获取到任何术语内容。请检查 URL 是否正确。";
            });
        }
        catch (Exception exception)
        {
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                _mobileSimpleTmState.StatusMessage = $"加载术语预览失败：{exception.Message}";
            });
        }
    }

    private async Task SyncMobileRemoteVscodeConfigAsync()
    {
        if (DataContext is not MainWindowViewModel viewModel || string.IsNullOrWhiteSpace(_mobileSimpleTmState.SharedUrl))
        {
            return;
        }

        try
        {
            var json = await _simpleTmRemoteClient.FetchVscodeConfigJsonAsync(_mobileSimpleTmState.SharedUrl).ConfigureAwait(false);
            using var document = JsonDocument.Parse(json);
            var applied = await Dispatcher.UIThread.InvokeAsync(() => viewModel.TryApplyRemoteParserConfig(document.RootElement));
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                _mobileSimpleTmState.StatusMessage = applied
                    ? "已从远程 vscode 配置应用双行格式设置。"
                    : "远程 vscode 配置中未包含双行格式设置。";
            });
        }
        catch (Exception exception)
        {
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                _mobileSimpleTmState.StatusMessage = $"同步远程 vscode 配置失败：{exception.Message}";
            });
        }
    }

    private void OpenUrl(string url)
    {
        try
        {
            var uri = new Uri(url);
            var topLevel = TopLevel.GetTopLevel(this);

            if (topLevel?.Launcher is not null)
            {
                _ = topLevel.Launcher.LaunchUriAsync(uri);
                return;
            }

            Process.Start(new ProcessStartInfo(url)
            {
                UseShellExecute = true,
            });
        }
        catch
        {
        }
    }

    private IStorageProvider? GetStorageProvider()
    {
        return TopLevel.GetTopLevel(this)?.StorageProvider;
    }

    private enum MobileModalKind
    {
        None,
        ParserSettings,
        SimpleTmSettings,
        BackgroundSettings,
        ReloadEncoding,
        Confirm,
        Help,
        About,
    }

    private sealed partial class MobileSimpleTmState : ViewModelBase
    {
        [ObservableProperty]
        private string _sharedUrl = string.Empty;

        [ObservableProperty]
        private string _previewBody = string.Empty;

        [ObservableProperty]
        private string _statusMessage = string.Empty;

        [ObservableProperty]
        private string _loadedPreviewUrl = string.Empty;
    }

    private sealed partial class MobileReloadEncodingState : ViewModelBase
    {
        private static readonly IReadOnlyList<string> DefaultEncodings = new[]
        {
            "utf8",
            "utf16le",
            "utf16be",
            "shift-jis",
            "gb2312",
            "gbk",
        };

        [ObservableProperty]
        private string _selectedEncoding = "utf8";

        public IReadOnlyList<string> Encodings { get; } = DefaultEncodings;

        public void SetEncoding(string? encodingName)
        {
            if (string.IsNullOrWhiteSpace(encodingName))
            {
                SelectedEncoding = Encodings[0];
                return;
            }

            var normalized = encodingName.Trim().ToLowerInvariant();
            SelectedEncoding = Encodings.Contains(normalized) ? normalized : Encodings[0];
        }
    }

    private sealed partial class MobileConfirmState : ViewModelBase
    {
        [ObservableProperty]
        private string _message = string.Empty;

        [ObservableProperty]
        private string _confirmButtonText = "确定";
    }

    private sealed class MobileAboutState : ViewModelBase
    {
        public string VersionText { get; } = $"版本：{App.Version}";
    }
}
