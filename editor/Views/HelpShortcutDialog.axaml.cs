using Avalonia.Controls;
using Avalonia.Interactivity;

namespace editor.Views;

public partial class HelpShortcutDialog : Window
{
    public HelpShortcutDialog()
    {
        InitializeComponent();
    }

    private void OnCloseClick(object? sender, RoutedEventArgs e)
    {
        Close();
    }
}
