using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Data.Core;
using Avalonia.Data.Core.Plugins;
using System;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Avalonia.Markup.Xaml;
using editor.Models;
using editor.ViewModels;
using editor.Views;

namespace editor;

public partial class App : Application
{
    private const string CurrentVersion = "1.0.0";
    public static string Version => CurrentVersion;
    private const string LatestVersionUrl = "https://raw.githubusercontent.com/jsc6924/dltxt-editor-release/refs/heads/main/latest";
    private const string ReleasesUrl = "https://github.com/jsc6924/dltxt-editor-release/releases";

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

        EditorThemeManager.ApplyTheme(this, EditorThemeManager.DefaultThemeName);

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow = new MainWindow
            {
                DataContext = new MainWindowViewModel(),
            };

            _ = CheckForUpdatesAsync(desktop.MainWindow);
        }
        else if (ApplicationLifetime is IActivityApplicationLifetime activity)
        {
            activity.MainViewFactory = CreateMainView;
        }
        else if (ApplicationLifetime is ISingleViewApplicationLifetime singleView)
        {
            singleView.MainView = CreateMainView();
        }

        base.OnFrameworkInitializationCompleted();
    }

    private static MainView CreateMainView()
    {
        return new MainView
        {
            DataContext = new MainWindowViewModel(),
        };
    }

    private static async Task CheckForUpdatesAsync(Window owner)
    {
        try
        {
            using var httpClient = new HttpClient();
            httpClient.Timeout = TimeSpan.FromSeconds(10);
            var remoteText = await httpClient.GetStringAsync(LatestVersionUrl);
            if (string.IsNullOrWhiteSpace(remoteText))
            {
                return;
            }

            var latestVersionText = remoteText.Trim();
            var currentVersion = ParseVersionSegments(CurrentVersion);
            var latestVersion = ParseVersionSegments(latestVersionText);
            if (currentVersion == null || latestVersion == null)
            {
                return;
            }

            for (var i = 0; i < 3; i++)
            {
                if (currentVersion[i] < latestVersion[i])
                {
                    var dialog = new ConfirmDialog($"检测到新版本 {latestVersionText}，是否前往 Releases 下载？");
                    var confirmed = await dialog.ShowDialog<bool?>(owner) ?? false;
                    if (confirmed)
                    {
                        OpenBrowser(ReleasesUrl);
                    }

                    break;
                }

                if (currentVersion[i] > latestVersion[i])
                {
                    break;
                }
            }
        }
        catch
        {
            // Ignore update check failures.
        }
    }

    private static int[]? ParseVersionSegments(string versionText)
    {
        var parts = versionText.Split('.');
        if (parts.Length != 3)
        {
            return null;
        }

        var segments = new int[3];
        for (var i = 0; i < 3; i++)
        {
            if (!int.TryParse(parts[i], out var value) || value < 0)
            {
                return null;
            }

            segments[i] = value;
        }

        return segments;
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true,
            };
            Process.Start(psi);
        }
        catch
        {
            // Ignore browser launch failures.
        }
    }
}