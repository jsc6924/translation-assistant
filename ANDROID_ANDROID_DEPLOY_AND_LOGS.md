# Android Build, Install, Launch, and Logs

This document records the exact commands used to build, install, launch, and inspect runtime logs for the Android app.

## 1) Build Android app (Debug)

Run from repository root:

```bash
dotnet build ./editor.Android/editor.Android.csproj -c Debug
```

Expected output includes:
- Build succeeded
- APK output under:
  - editor.Android/bin/Debug/net10.0-android/com.jsc6924.dltxteditor-Signed.apk

## 2) Install APK to phone

Windows PowerShell form:

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" install -r "C:\Users\jscjs\source\repos\translation-assistant\editor.Android\bin\Debug\net10.0-android\com.jsc6924.dltxteditor-Signed.apk"
```

Expected output:
- Success

## 3) Launch app on phone

Use launcher intent:

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" shell monkey -p com.jsc6924.dltxteditor -c android.intent.category.LAUNCHER 1
```

Expected output includes:
- Events injected: 1

## 4) Basic device checks

Check connected devices:

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" devices
```

Check Android API level:

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" shell getprop ro.build.version.sdk
```

## 5) Runtime logs (logcat)

### 5.1 Live logs for app process

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" logcat --pid=$(& "C:\Android\SDK\platform-tools\adb.exe" shell pidof -s com.jsc6924.dltxteditor)
```

Note: if app is not running, pidof returns empty. Start app first.

### 5.2 Filter by package name keywords

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" logcat | findstr /I "com.jsc6924.dltxteditor AndroidRuntime"
```

### 5.3 Capture crash-focused logs

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" logcat -v time AndroidRuntime:E *:S
```

### 5.4 Clear old logs before repro

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" logcat -c
```

Then reproduce the issue and run one of the commands above.

## 6) Optional: check app storage permission app-op

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" shell cmd appops get --uid com.jsc6924.dltxteditor MANAGE_EXTERNAL_STORAGE
```

Set to allow (if needed):

```powershell
& "C:\Android\SDK\platform-tools\adb.exe" shell appops set --uid com.jsc6924.dltxteditor MANAGE_EXTERNAL_STORAGE allow
```

## 7) Quick one-shot sequence

```powershell
dotnet build .\editor.Android\editor.Android.csproj -c Debug
& "C:\Android\SDK\platform-tools\adb.exe" install -r "C:\Users\jscjs\source\repos\translation-assistant\editor.Android\bin\Debug\net10.0-android\com.jsc6924.dltxteditor-Signed.apk"
& "C:\Android\SDK\platform-tools\adb.exe" shell monkey -p com.jsc6924.dltxteditor -c android.intent.category.LAUNCHER 1
```
