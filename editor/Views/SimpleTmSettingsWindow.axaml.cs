using Avalonia.Controls;
using Avalonia.Interactivity;

namespace editor.Views;

public partial class SimpleTmSettingsWindow : Window
{
    public string SharedUrl { get; set; }

    public SimpleTmSettingsWindow()
    {
        InitializeComponent();
        SharedUrl = string.Empty;
        DataContext = this;
    }

    public SimpleTmSettingsWindow(string currentUrl)
        : this()
    {
        SharedUrl = currentUrl ?? string.Empty;
    }

    private void OnSaveClick(object? sender, RoutedEventArgs e)
    {
        Close(true);
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e)
    {
        Close(false);
    }
}
