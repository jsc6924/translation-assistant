using System;
using CommunityToolkit.Mvvm.ComponentModel;

namespace editor.ViewModels;

public partial class BackgroundSettingsViewModel : ViewModelBase
{
    [ObservableProperty]
    private string _selectedImagePath = string.Empty;

    [ObservableProperty]
    private double _backgroundOpacity = 0.5;

    [ObservableProperty]
    private bool _backgroundFillMode;

    [ObservableProperty]
    private string _statusMessage = string.Empty;

    [ObservableProperty]
    private string _opacityLabel = "50%";

    public BackgroundSettingsViewModel(string initialImagePath, double initialOpacity, bool initialFillMode)
    {
        SelectedImagePath = initialImagePath ?? string.Empty;
        BackgroundOpacity = Math.Clamp(initialOpacity, 0.0, 1.0);
        BackgroundFillMode = initialFillMode;
        OpacityLabel = GetOpacityLabel(BackgroundOpacity);
    }

    public bool HasStatusMessage => !string.IsNullOrWhiteSpace(StatusMessage);

    public string BackgroundModeLabel => BackgroundFillMode ? "铺满区域" : "全部显示";

    partial void OnBackgroundOpacityChanged(double value)
    {
        OpacityLabel = GetOpacityLabel(value);
    }

    partial void OnStatusMessageChanged(string value)
    {
        OnPropertyChanged(nameof(HasStatusMessage));
    }

    private static string GetOpacityLabel(double opacity)
    {
        return $"{Math.Round(opacity * 100)}%";
    }
}
