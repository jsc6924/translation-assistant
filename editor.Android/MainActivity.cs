using Android.App;
using Android.Content.PM;
using Android.OS;
using Avalonia.Android;
using System;
using System.Text;
using System.Diagnostics.CodeAnalysis;
using Android.Content;
using System.Runtime.Versioning;

namespace editor.Android;

[Activity(
    Label = "dltxt editor",
    Theme = "@style/Theme.AppCompat.DayNight.NoActionBar",
    Icon = "@drawable/logo",
    MainLauncher = true,
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize | ConfigChanges.UiMode)]
public class MainActivity : AvaloniaMainActivity
{
    // 1. 保护中文编码库
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(CodePagesEncodingProvider))]

    // 2. 🚀【带上完整命名空间】：显式锁死 Avalonia 的字体管理器与字模，防止编译失败
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(Avalonia.Media.FontManager))]
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, typeof(Avalonia.Media.Typeface))]

    // 3. 🚀【追加全量保底】：告诉裁剪器，Avalonia.Media 里的文本渲染基础设施一个都不准切
    [DynamicDependency(DynamicallyAccessedMemberTypes.All, "Avalonia.Media.TextFormatting.TextRun", "Avalonia.Base")]
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        // 确保第一时间注册中文支持
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        base.OnCreate(savedInstanceState);

        CheckAndRequestStoragePermission();
    }

    protected override void OnResume()
    {
        base.OnResume();

        // 🚀 极为关键：当用户从设置页面切回 App 时，再次触发检查
        // 如果用户还是没开，我们可以继续弹窗或者进行引导
        CheckAndRequestStoragePermission();
    }

    [SupportedOSPlatform("android30.0")]
    private void CheckAndRequestStoragePermission()
    {
        if (Build.VERSION.SdkInt >= BuildVersionCodes.R)
        {
            if (!global::Android.OS.Environment.IsExternalStorageManager)
            {
                new global::Android.App.AlertDialog.Builder(this)
                    .SetTitle("权限申请说明")
                    .SetMessage("dltxt editor 需要「所有文件访问权限」来扫描和读取您选定的游戏文本文件夹。否则应用将无法在列表中为您展示任何文件。\n\n点击下方按钮将为您打开系统设置，请手动勾选“允许访问所有文件”。")
                    .SetCancelable(false)

                    // 🚀 核心修复：使用安卓专属的 DialogClickEventArgs 参数类型
                    .SetPositiveButton("去设置", (object? sender, global::Android.Content.DialogClickEventArgs e) =>
                    {
                        Intent intent = new Intent(global::Android.Provider.Settings.ActionManageAppAllFilesAccessPermission);

                        string currentPackageName = PackageName ?? "com.jsc6924.dltxteditor";
                        global::Android.Net.Uri uri = global::Android.Net.Uri.Parse($"package:{currentPackageName}")!;
                        intent.SetData(uri);

                        try
                        {
                            StartActivity(intent);
                        }
                        catch (System.Exception)
                        {
                            Intent genericIntent = new Intent(global::Android.Provider.Settings.ActionManageAllFilesAccessPermission);
                            StartActivity(genericIntent);
                        }
                    })

                    // 🚀 核心修复：同样在这里使用 DialogClickEventArgs
                    .SetNegativeButton("拒绝并退出", (object? sender, global::Android.Content.DialogClickEventArgs e) =>
                    {
                        this.FinishAffinity();
                    })
                    .Show();
            }
        }
    }
}