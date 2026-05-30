using Avalonia.Controls;
using Avalonia.Interactivity;

namespace editor.Views;

public partial class ConfirmDialog : Window
{
    public string Message { get; set; } = string.Empty;

    public ConfirmDialog()
    {
        InitializeComponent();
        DataContext = this;
    }

    public ConfirmDialog(string message)
        : this()
    {
        Message = message;
        DataContext = this;
    }

    private void OnOkClick(object? sender, RoutedEventArgs e)
    {
        Close(true);
    }

    private void OnCancelClick(object? sender, RoutedEventArgs e)
    {
        Close(false);
    }
}
