using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using Avalonia.Controls;
using Avalonia.Interactivity;

namespace editor.Views;

public partial class ReloadEncodingWindow : Window, INotifyPropertyChanged
{
    private string _selectedEncoding = string.Empty;

    public ReloadEncodingWindow()
    {
        InitializeComponent();
        DataContext = this;
        SelectedEncoding = Encodings[0];
    }

    public ReloadEncodingWindow(string currentEncodingName)
        : this()
    {
        SelectedEncoding = NormalizeEncodingName(currentEncodingName) ?? Encodings[0];
    }

    public IReadOnlyList<string> Encodings { get; } = new[]
    {
        "utf8",
        "utf16le",
        "utf16be",
        "shift-jis",
        "gb2312",
        "gbk",
    };

    public string SelectedEncoding
    {
        get => _selectedEncoding;
        set
        {
            if (string.Equals(_selectedEncoding, value, StringComparison.Ordinal))
            {
                return;
            }

            _selectedEncoding = value ?? Encodings[0];
            RaisePropertyChanged();
        }
    }

    public new event PropertyChangedEventHandler? PropertyChanged;

    private void OnConfirmClick(object? sender, RoutedEventArgs e)
    {
        Close(true);
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e)
    {
        Close(false);
    }

    private string? NormalizeEncodingName(string? encodingName)
    {
        if (string.IsNullOrWhiteSpace(encodingName))
        {
            return null;
        }

        var normalized = encodingName.Trim().ToLowerInvariant();
        return Encodings.Contains(normalized) ? normalized : null;
    }

    private void RaisePropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
