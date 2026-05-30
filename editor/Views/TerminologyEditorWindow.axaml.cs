using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using Avalonia.Controls;
using Avalonia.Interactivity;

namespace editor.Views;

public partial class TerminologyEditorWindow : Window, INotifyPropertyChanged
{
    private string _rawText = string.Empty;
    private string _translation = string.Empty;

    public TerminologyEditorWindow()
    {
        InitializeComponent();
        DataContext = this;
    }

    public string RawText
    {
        get => _rawText;
        set
        {
            if (string.Equals(_rawText, value, StringComparison.Ordinal))
            {
                return;
            }

            _rawText = value;
            RaisePropertyChanged();
        }
    }

    public string Translation
    {
        get => _translation;
        set
        {
            if (string.Equals(_translation, value, StringComparison.Ordinal))
            {
                return;
            }

            _translation = value;
            RaisePropertyChanged();
        }
    }

    public TerminologyEditorWindow(string rawText, string translation)
        : this()
    {
        RawText = rawText;
        Translation = translation;
    }

    private void OnSaveClick(object? sender, RoutedEventArgs e)
    {
        Close(true);
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e)
    {
        Close(false);
    }

    public new event PropertyChangedEventHandler? PropertyChanged;

    private void RaisePropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
