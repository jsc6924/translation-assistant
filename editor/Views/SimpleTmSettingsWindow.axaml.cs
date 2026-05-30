using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Threading;
using editor.Models;
using editor.Services;
using editor.ViewModels;

namespace editor.Views;

public partial class SimpleTmSettingsWindow : Window, INotifyPropertyChanged
{
    private readonly SimpleTmRemoteClient _remoteClient = new();
    private readonly MainWindowViewModel? _ownerViewModel;
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

    public SimpleTmSettingsWindow(string currentUrl, MainWindowViewModel ownerViewModel)
        : this(currentUrl)
    {
        _ownerViewModel = ownerViewModel;
    }

    private async void OnRefreshPreviewClick(object? sender, RoutedEventArgs e)
    {
        await LoadPreviewAsync();
        await SyncRemoteVscodeConfigAsync();
    }

    private async void OnSaveClick(object? sender, RoutedEventArgs e)
    {
        if (!string.Equals(_loadedPreviewUrl, SharedUrl, StringComparison.OrdinalIgnoreCase))
        {
            await LoadPreviewAsync();
            return;
        }

        await SyncRemoteVscodeConfigAsync();
        Close(true);
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e)
    {
        Close(false);
    }

    private async System.Threading.Tasks.Task LoadPreviewAsync()
    {
        await Dispatcher.UIThread.InvokeAsync(() => {
            PreviewBody = string.Empty;
            StatusMessage = string.IsNullOrWhiteSpace(SharedUrl)
                ? "请输入术语库 URL 后再刷新预览。"
                : "正在从远程服务器加载术语预览...";
        });

        if (string.IsNullOrWhiteSpace(SharedUrl))
        {
            return;
        }

        try
        {
            var previewResult = await _remoteClient.FetchTermsJsonAsync(SharedUrl).ConfigureAwait(false);
            await Dispatcher.UIThread.InvokeAsync(() => {
                PreviewBody = previewResult;
                _loadedPreviewUrl = SharedUrl;
                StatusMessage = !string.IsNullOrWhiteSpace(PreviewBody)
                    ? "已加载术语 JSON 预览。再次点击 保存 即可完成保存。"
                    : "从远程服务器未获取到任何术语内容。请检查 URL 是否正确。";
            });
        }
        catch (Exception exception)
        {
            await Dispatcher.UIThread.InvokeAsync(() => {
                StatusMessage = $"加载术语预览失败：{exception.Message}";
            });
        }
    }

    private async System.Threading.Tasks.Task SyncRemoteVscodeConfigAsync()
    {
        if (_ownerViewModel is null)
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(SharedUrl))
        {
            return;
        }

        try
        {
            var json = await _remoteClient.FetchVscodeConfigJsonAsync(SharedUrl).ConfigureAwait(false);
            using var document = JsonDocument.Parse(json);
            var applied = await Dispatcher.UIThread.InvokeAsync(() => _ownerViewModel.TryApplyRemoteParserConfig(document.RootElement));
            await Dispatcher.UIThread.InvokeAsync(() => {
                StatusMessage = applied
                    ? "已从远程 vscode 配置应用双行格式设置。"
                    : "远程 vscode 配置中未包含双行格式设置。";
            });
        }
        catch (Exception exception)
        {
            await Dispatcher.UIThread.InvokeAsync(() => {
                StatusMessage = $"同步远程 vscode 配置失败：{exception.Message}";
            });
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
