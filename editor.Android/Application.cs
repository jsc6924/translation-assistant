using Android.App;
using Android.Runtime;
using Avalonia;
using Avalonia.Android;

namespace editor.Android;

[Application]
public class Application : AvaloniaAndroidApplication<global::editor.App>
{
    protected Application(nint javaReference, JniHandleOwnership transfer) : base(javaReference, transfer)
    {
    }

    protected override AppBuilder CustomizeAppBuilder(AppBuilder builder)
    {
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        return base.CustomizeAppBuilder(builder)
            .WithInterFont()
            .LogToTrace();
    }
}