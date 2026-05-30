using Avalonia.Controls;
using Avalonia.Interactivity;
using editor.Models;
using editor.Services;
using editor.ViewModels;

namespace editor.Views;

public partial class ParserSettingsWindow : Window
{
    public ParserSettingsWindow()
        : this(new ParserConfig())
    {
    }

    public ParserSettingsWindow(ParserConfig parserConfig)
    {
        InitializeComponent();
        DataContext = new ParserSettingsViewModel(parserConfig);
    }

    public ParserConfig? ResultConfig { get; private set; }

    private void OnCancelClick(object? sender, RoutedEventArgs eventArgs)
    {
        Close();
    }

    private void OnSaveClick(object? sender, RoutedEventArgs eventArgs)
    {
        if (DataContext is not ParserSettingsViewModel viewModel)
        {
            return;
        }

        var parserConfig = viewModel.ToParserConfig();
        if (!DualLineDocumentParser.TryValidate(parserConfig, out var error))
        {
            viewModel.ValidationMessage = error ?? "双行格式无效。";
            return;
        }

        viewModel.ValidationMessage = string.Empty;
        ResultConfig = parserConfig;
        Close();
    }
}