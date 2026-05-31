using System.Linq;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using editor.ViewModels;

namespace editor.Views;

public partial class BackgroundSettingsWindow : Window
{
    public BackgroundSettingsWindow()
        : this(string.Empty, 0.5, false)
    {
    }

    public BackgroundSettingsWindow(string currentImagePath, double currentOpacity, bool currentFillMode)
    {
        InitializeComponent();
        DataContext = new BackgroundSettingsViewModel(currentImagePath, currentOpacity, currentFillMode);
    }

    public string SelectedImagePath
    {
        get
        {
            return DataContext is BackgroundSettingsViewModel viewModel
                ? viewModel.SelectedImagePath
                : string.Empty;
        }
    }

    public double SelectedOpacity
    {
        get
        {
            return DataContext is BackgroundSettingsViewModel viewModel
                ? viewModel.BackgroundOpacity
                : 0.5;
        }
    }

    public bool SelectedFillMode
    {
        get
        {
            return DataContext is BackgroundSettingsViewModel viewModel
                ? viewModel.BackgroundFillMode
                : false;
        }
    }

    private async void OnSelectImageClick(object? sender, RoutedEventArgs eventArgs)
    {
        var storageProvider = StorageProvider;
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

        var options = new FilePickerOpenOptions
        {
            Title = "选择背景图片",
            AllowMultiple = false,
            FileTypeFilter = fileTypes,
        };

        var files = await StorageProvider.OpenFilePickerAsync(options);
        var file = files.FirstOrDefault();
        if (file is null)
        {
            return;
        }

        var localPath = file.TryGetLocalPath();
        if (string.IsNullOrWhiteSpace(localPath))
        {
            return;
        }

        if (DataContext is BackgroundSettingsViewModel viewModel)
        {
            viewModel.SelectedImagePath = localPath;
        }
    }

    private void OnCancelClick(object? sender, RoutedEventArgs eventArgs)
    {
        Close(false);
    }

    private void OnClearClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is BackgroundSettingsViewModel viewModel)
        {
            viewModel.SelectedImagePath = string.Empty;
        }
    }

    private void OnSaveClick(object? sender, RoutedEventArgs eventArgs)
    {
        Close(true);
    }
}
