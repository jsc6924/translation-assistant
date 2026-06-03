using Android.App;
using Android.Content.PM;
using Avalonia.Android;

namespace editor.Android;

[Activity(
    Label = "dltxt editor",
    Theme = "@style/Theme.AppCompat.DayNight.NoActionBar",
    Icon = "@drawable/logo",
    MainLauncher = true,
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize | ConfigChanges.UiMode)]
public class MainActivity : AvaloniaMainActivity
{
}