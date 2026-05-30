using CommunityToolkit.Mvvm.ComponentModel;
using editor.Models;

namespace editor.ViewModels;

public partial class ParserSettingsViewModel : ViewModelBase
{
    [ObservableProperty]
    private string _originalPrefixRegex = string.Empty;

    [ObservableProperty]
    private string _translatedPrefixRegex = string.Empty;

    [ObservableProperty]
    private string _originalWhiteRegex = string.Empty;

    [ObservableProperty]
    private string _translatedWhiteRegex = string.Empty;

    [ObservableProperty]
    private string _originalSuffixRegex = string.Empty;

    [ObservableProperty]
    private string _translatedSuffixRegex = string.Empty;

    [ObservableProperty]
    private string _nameRegex = string.Empty;

    [ObservableProperty]
    private string _validationMessage = string.Empty;

    public ParserSettingsViewModel()
        : this(new ParserConfig())
    {
    }

    public ParserSettingsViewModel(ParserConfig parserConfig)
    {
        var clonedConfig = parserConfig.Clone();
        OriginalPrefixRegex = clonedConfig.OriginalPrefixRegex;
        TranslatedPrefixRegex = clonedConfig.TranslatedPrefixRegex;
        OriginalWhiteRegex = clonedConfig.OriginalWhiteRegex;
        TranslatedWhiteRegex = clonedConfig.TranslatedWhiteRegex;
        OriginalSuffixRegex = clonedConfig.OriginalSuffixRegex;
        TranslatedSuffixRegex = clonedConfig.TranslatedSuffixRegex;
        NameRegex = clonedConfig.NameRegex;
    }

    public bool HasValidationMessage => !string.IsNullOrWhiteSpace(ValidationMessage);

    public ParserConfig ToParserConfig()
    {
        return new ParserConfig
        {
            OriginalPrefixRegex = OriginalPrefixRegex,
            TranslatedPrefixRegex = TranslatedPrefixRegex,
            OriginalWhiteRegex = OriginalWhiteRegex,
            TranslatedWhiteRegex = TranslatedWhiteRegex,
            OriginalSuffixRegex = OriginalSuffixRegex,
            TranslatedSuffixRegex = TranslatedSuffixRegex,
            NameRegex = NameRegex,
        };
    }

    partial void OnValidationMessageChanged(string value)
    {
        OnPropertyChanged(nameof(HasValidationMessage));
    }
}