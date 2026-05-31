using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Media;
using Avalonia.Styling;

namespace editor.Models;

public static class EditorThemeManager
{
    public static string DefaultThemeName => "Default";

    public static IReadOnlyList<string> ThemeNames { get; } = new[]
    {
        DefaultThemeName,
        "Dark",
    };

    private static readonly IReadOnlyDictionary<string, EditorThemeDefinition> ThemeDefinitions =
        new Dictionary<string, EditorThemeDefinition>(StringComparer.OrdinalIgnoreCase)
        {
            [DefaultThemeName] = new(
                ThemeVariant: ThemeVariant.Default,
                HeaderBackground: Color.Parse("#fafafa"),
                TreeviewBackground: Color.Parse("#EEEEEE"),
                FooterBackground: Color.Parse("#75B2E7"),
                EditorTextForeground: Color.Parse("#000000"),
                EditorBackground: Color.Parse("#FEFEFE"),
                EditorCaret: Color.Parse("#000000"),
                OriginalPrefix: Color.Parse("#80006c28"),
                OriginalText: Color.Parse("#008E44"),
                TranslatedPrefix: Color.Parse("#80000000"),
                TranslatedText: Color.Parse("#000000"),
                TabItemBackground: Color.Parse("#F4F8FC"),
                TabItemSelectedBackground: Color.Parse("#E4EEF7"),
                TabItemBorder: Color.Parse("#C8D8EB"),
                TabItemSelectedForeground: Color.Parse("#000000")),
            ["Dark"] = new(
                ThemeVariant: ThemeVariant.Dark,
                HeaderBackground: Color.Parse("#2a2a2c"),
                TreeviewBackground: Color.Parse("#242323"),
                FooterBackground: Color.Parse("#007ACC"),
                EditorTextForeground: Color.Parse("#FFFFFF"),
                EditorBackground: Color.Parse("#1E1E1E"),
                EditorCaret: Color.Parse("#FFFFFF"),
                OriginalPrefix: Color.Parse("#80B5EAEA"),
                OriginalText: Color.Parse("#7CFF9E"),
                TranslatedPrefix: Color.Parse("#80FFFFFF"),
                TranslatedText: Color.Parse("#FFFFFF"),
                TabItemBackground: Color.Parse("#252526"),
                TabItemSelectedBackground: Color.Parse("#094771"),
                TabItemBorder: Color.Parse("#3C3C3C"),
                TabItemSelectedForeground: Color.Parse("#FFFFFF")),
        };

    public static EditorThemeDefinition GetThemeDefinition(string themeName)
    {
        return ThemeDefinitions.TryGetValue(themeName, out var themeDefinition)
            ? themeDefinition
            : ThemeDefinitions[DefaultThemeName];
    }

    public static void ApplyTheme(Application app, string themeName)
    {
        if (app is null)
        {
            return;
        }

        var themeDefinition = GetThemeDefinition(themeName);
        app.RequestedThemeVariant = themeDefinition.ThemeVariant;
        app.Resources["HeaderBackgroundBrush"] = new SolidColorBrush(themeDefinition.HeaderBackground);
        app.Resources["TreeviewBackgroundBrush"] = new SolidColorBrush(themeDefinition.TreeviewBackground);
        app.Resources["FooterBackgroundBrush"] = new SolidColorBrush(themeDefinition.FooterBackground);
        app.Resources["EditorTextForegroundBrush"] = new SolidColorBrush(themeDefinition.EditorTextForeground);
        app.Resources["EditorBackgroundBrush"] = new SolidColorBrush(themeDefinition.EditorBackground);
        app.Resources["EditorCaretBrush"] = new SolidColorBrush(themeDefinition.EditorCaret);
        app.Resources["EditorOriginalPrefixBrush"] = new SolidColorBrush(themeDefinition.OriginalPrefix);
        app.Resources["EditorOriginalTextBrush"] = new SolidColorBrush(themeDefinition.OriginalText);
        app.Resources["EditorTranslatedPrefixBrush"] = new SolidColorBrush(themeDefinition.TranslatedPrefix);
        app.Resources["EditorTranslatedTextBrush"] = new SolidColorBrush(themeDefinition.TranslatedText);
        app.Resources["TabItemBackgroundBrush"] = new SolidColorBrush(themeDefinition.TabItemBackground);
        app.Resources["TabItemSelectedBackgroundBrush"] = new SolidColorBrush(themeDefinition.TabItemSelectedBackground);
        app.Resources["TabItemBorderBrush"] = new SolidColorBrush(themeDefinition.TabItemBorder);
        app.Resources["TabItemSelectedForegroundBrush"] = new SolidColorBrush(themeDefinition.TabItemSelectedForeground);
    }
}

public sealed record EditorThemeDefinition(
    ThemeVariant ThemeVariant,
    Color HeaderBackground,
    Color TreeviewBackground,
    Color FooterBackground,
    Color EditorTextForeground,
    Color EditorBackground,
    Color EditorCaret,
    Color OriginalPrefix,
    Color OriginalText,
    Color TranslatedPrefix,
    Color TranslatedText,
    Color TabItemBackground,
    Color TabItemSelectedBackground,
    Color TabItemBorder,
    Color TabItemSelectedForeground);