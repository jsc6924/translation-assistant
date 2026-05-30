using System;
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
using editor.ViewModels;

namespace editor.Views;

public partial class MainWindow : Window
{
    private readonly DispatcherTimer _autoSaveTimer;

    public MainWindow()
    {
        InitializeComponent();
        Closing += OnClosing;

        _autoSaveTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(30),
        };
        _autoSaveTimer.Tick += OnAutoSaveTimerTick;
        _autoSaveTimer.Start();
    }

    private async void OnConfigureFormatClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var dialog = new ParserSettingsWindow(viewModel.ParserConfig);
        await dialog.ShowDialog(this);
        if (dialog.ResultConfig is ParserConfig parserConfig)
        {
            viewModel.ApplyParserConfig(parserConfig);
        }
    }
    private async void OnConfigureSimpleTmClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not MainWindowViewModel viewModel)
        {
            return;
        }

        var dialog = new SimpleTmSettingsWindow(viewModel.SimpleTmSharedUrl, viewModel);
        var confirmed = await dialog.ShowDialog<bool?>(this) ?? false;
        if (!confirmed)
        {
            return;
        }

        viewModel.SetSimpleTmSharedUrl(dialog.SharedUrl);
    }
    private void OnClosing(object? sender, WindowClosingEventArgs eventArgs)
    {
        _autoSaveTimer.Stop();

        if (DataContext is MainWindowViewModel viewModel)
        {
            if (!viewModel.SaveAll(out var error))
            {
                viewModel.SetStatus($"关闭时保存失败：{error}");
                eventArgs.Cancel = true;
            }
        }
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
                }

                break;
            }
        }
    }

    private async void OnOpenFolderClick(object? sender, RoutedEventArgs eventArgs)
    {
        await PickFolderAndLoadAsync(false);
    }

    private void OnOpenRecentFolderClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (sender is not Button button || button.DataContext is not string folderPath)
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

        viewModel.LoadWorkspace(folderPath);
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

        var target = node.IsDirectory ? "文件夹" : "文件";
        var dialog = new ConfirmDialog($"确认删除 {target}：{node.DisplayName}？\n此操作无法撤销。");
        var confirmed = await dialog.ShowDialog<bool?>(this) ?? false;
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
        var dialog = new HelpShortcutDialog();
        _ = dialog.ShowDialog(this);
    }

    private void OnAboutClick(object? sender, RoutedEventArgs eventArgs)
    {
        var dialog = new AboutDialog();
        _ = dialog.ShowDialog(this);
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

        if (!StorageProvider.CanPickFolder)
        {
            viewModel.SetStatus("当前平台不支持文件夹选择。请改用支持文件系统访问的桌面环境。");
            return !requireSelection;
        }

        var folders = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
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

        var path = folder.TryGetLocalPath();
        if (string.IsNullOrWhiteSpace(path))
        {
            viewModel.SetStatus("所选文件夹无法映射到本地路径。请重新选择。" );
            return !requireSelection;
        }

        viewModel.LoadWorkspace(path);
        return true;
    }
}