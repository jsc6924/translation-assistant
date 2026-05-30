using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Interactivity;

namespace editor.Views;

public partial class AboutDialog : Window
{
    private const string VsCodeUrl = "https://code.visualstudio.com/download";
    private const string DltxtUrl = "https://github.com/jsc6924/translation-assistant";

    public string VersionText { get; } = $"版本：{App.Version}";

    public AboutDialog()
    {
        InitializeComponent();
        DataContext = this;
    }

    private void OnDownloadVsCodeClick(object? sender, RoutedEventArgs e)
    {
        OpenUrl(VsCodeUrl);
    }

    private void OnViewDltxtClick(object? sender, RoutedEventArgs e)
    {
        OpenUrl(DltxtUrl);
    }

    private void OnCloseClick(object? sender, RoutedEventArgs e)
    {
        Close();
    }

    private static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url)
            {
                UseShellExecute = true,
            });
        }
        catch
        {
            // ignore failures opening browser
        }
    }
}
