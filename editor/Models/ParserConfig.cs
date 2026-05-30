using System.Text.Json.Serialization;

namespace editor.Models;

public sealed class ParserConfig
{
    public string OriginalPrefixRegex { get; set; } = string.Empty;

    public string TranslatedPrefixRegex { get; set; } = string.Empty;

    public string OriginalWhiteRegex { get; set; } = string.Empty;

    public string TranslatedWhiteRegex { get; set; } = string.Empty;

    public string OriginalSuffixRegex { get; set; } = string.Empty;

    public string TranslatedSuffixRegex { get; set; } = string.Empty;

    public string NameRegex { get; set; } = string.Empty;

    [JsonIgnore]
    public bool IsConfigured => !string.IsNullOrWhiteSpace(OriginalPrefixRegex) && !string.IsNullOrWhiteSpace(TranslatedPrefixRegex);

    public ParserConfig Clone()
    {
        return new ParserConfig
        {
            OriginalPrefixRegex = OriginalPrefixRegex ?? string.Empty,
            TranslatedPrefixRegex = TranslatedPrefixRegex ?? string.Empty,
            OriginalWhiteRegex = OriginalWhiteRegex ?? string.Empty,
            TranslatedWhiteRegex = TranslatedWhiteRegex ?? string.Empty,
            OriginalSuffixRegex = OriginalSuffixRegex ?? string.Empty,
            TranslatedSuffixRegex = TranslatedSuffixRegex ?? string.Empty,
            NameRegex = NameRegex ?? string.Empty,
        };
    }

    public static ParserConfig Default()
    {
        return new ParserConfig
        {
            OriginalPrefixRegex = "\u2605[A-Za-z0-9]\\u002B\u2605",
            TranslatedPrefixRegex = "\u2606[A-Za-z0-9]\\u002B\u2606",
            OriginalWhiteRegex = "\\s*[\u300C]?",
            TranslatedWhiteRegex = "\\s*[\u300C]?",
            OriginalSuffixRegex = "[\u300D]?",
            TranslatedSuffixRegex = "[\u300D]?",
        };
    }

    public void Normalize()
    {
        OriginalPrefixRegex ??= string.Empty;
        TranslatedPrefixRegex ??= string.Empty;
        OriginalWhiteRegex ??= string.Empty;
        TranslatedWhiteRegex ??= string.Empty;
        OriginalSuffixRegex ??= string.Empty;
        TranslatedSuffixRegex ??= string.Empty;
        NameRegex ??= string.Empty;
    }
}