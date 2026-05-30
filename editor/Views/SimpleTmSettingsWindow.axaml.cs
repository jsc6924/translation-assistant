using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using Avalonia.Controls;
using Avalonia.Interactivity;
using editor.Models;
using editor.Services;

namespace editor.Views;

public partial class SimpleTmSettingsWindow : Window, INotifyPropertyChanged
{
    private readonly SimpleTmRemoteClient _remoteClient = new();
    private string _sharedUrl = string.Empty;
    private string _statusMessage = string.Empty;
    private string _previewBody = string.Empty;
    private string _loadedPreviewUrl = string.Empty;

    public string SharedUrl
    {
        get => _sharedUrl;
        set
        {
            if (string.Equals(_sharedUrl, value, StringComparison.Ordinal))
            {
                return;
            }

            _sharedUrl = value ?? string.Empty;
            RaisePropertyChanged();
        }
    }

    public string PreviewBody
    {
        get => _previewBody;
        set
        {
            if (string.Equals(_previewBody, value, StringComparison.Ordinal))
            {
                return;
            }

            _previewBody = value ?? string.Empty;
            RaisePropertyChanged();
        }
    }

    public string StatusMessage
    {
        get => _statusMessage;
        set
        {
            if (string.Equals(_statusMessage, value, StringComparison.Ordinal))
            {
                return;
            }

            _statusMessage = value ?? string.Empty;
            RaisePropertyChanged();
        }
    }

    public SimpleTmSettingsWindow()
    {
        InitializeComponent();
        DataContext = this;
    }

    public SimpleTmSettingsWindow(string currentUrl)
        : this()
    {
        SharedUrl = currentUrl ?? string.Empty;
    }

    private async void OnRefreshPreviewClick(object? sender, RoutedEventArgs e)
    {
        await LoadPreviewAsync().ConfigureAwait(false);
    }

    private async void OnSaveClick(object? sender, RoutedEventArgs e)
    {
        if (!string.Equals(_loadedPreviewUrl, SharedUrl, StringComparison.OrdinalIgnoreCase))
        {
            await LoadPreviewAsync().ConfigureAwait(false);
            return;
        }

        Close(true);
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e)
    {
        Close(false);
    }

    private async System.Threading.Tasks.Task LoadPreviewAsync()
    {
        PreviewBody = string.Empty;
        if (string.IsNullOrWhiteSpace(SharedUrl))
        {
            StatusMessage = "请输入术语库 URL 后再刷新预览。";
            return;
        }

        StatusMessage = "正在从远程服务器加载术语预览...";
        try
        {
            PreviewBody = await _remoteClient.FetchTermsJsonAsync(SharedUrl).ConfigureAwait(false);
            _loadedPreviewUrl = SharedUrl;
            StatusMessage = !string.IsNullOrWhiteSpace(PreviewBody)
                ? "已加载术语 JSON 预览。再次点击 保存 即可完成保存。"
                : "从远程服务器未获取到任何术语内容。请检查 URL 是否正确。";
        }
        catch (Exception exception)
        {
            StatusMessage = $"加载术语预览失败：{exception.Message}";
        }
    }

    public new event PropertyChangedEventHandler? PropertyChanged;

    private void RaisePropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }

    public sealed class SimpleTmPreviewItem
    {
        public SimpleTmPreviewItem(string raw, string translation, string? comment)
        {
            Raw = raw;
            Translation = translation;
            Comment = string.IsNullOrWhiteSpace(comment) ? string.Empty : comment;
        }

        public string Raw { get; }

        public string Translation { get; }

        public string Comment { get; }
    }
}
