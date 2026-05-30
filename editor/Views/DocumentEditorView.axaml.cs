using System;
using System.ComponentModel;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using AvaloniaEdit.Document;
using editor.Controls;
using editor.Models;
using editor.Services;
using editor.ViewModels;

namespace editor.Views;

public partial class DocumentEditorView : UserControl
{
    private readonly DualLineDocumentParser _parser = new();
    private readonly DualLineColorizer _colorizer = new();
    private EditorDocumentViewModel? _viewModel;

    public DocumentEditorView()
    {
        InitializeComponent();
        Editor.Document = new TextDocument();
        DataContextChanged += OnDataContextChanged;
        AttachedToVisualTree += OnAttachedToVisualTree;
        DetachedFromVisualTree += OnDetachedFromVisualTree;
        Editor.TextArea.KeyDown += OnEditorTextAreaKeyDown;
        Editor.TextArea.TextEntering += OnEditorTextEntering;
        EnsureEditorHooks();
    }

    private void ApplyReadOnlySections(ParsedDocument parsedDocument)
    {
        if (Editor.Document is null || !parsedDocument.IsConfigured)
        {
            Editor.TextArea.ReadOnlySectionProvider = AllowAllReadOnlySectionProvider.Instance;
            return;
        }

        Editor.TextArea.ReadOnlySectionProvider = new EditableSectionProvider(parsedDocument.EditableSegments);
    }

    private void OnDataContextChanged(object? sender, EventArgs eventArgs)
    {
        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
            _viewModel.Document.Changed -= OnDocumentChanged;
        }

        _viewModel = DataContext as EditorDocumentViewModel;
        if (_viewModel is null)
        {
            Editor.Document = new TextDocument();
            EnsureEditorHooks();
            _colorizer.Update(new ParsedDocument(false));
            Editor.TextArea.ReadOnlySectionProvider = AllowAllReadOnlySectionProvider.Instance;
            Editor.TextArea.TextView.Redraw();
            return;
        }

        Editor.Document = _viewModel.Document;
        EnsureEditorHooks();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.Document.Changed += OnDocumentChanged;
        RefreshParserState();
    }

    private void OnAttachedToVisualTree(object? sender, VisualTreeAttachmentEventArgs eventArgs)
    {
        EnsureEditorHooks();
        RefreshParserState();
    }

    private void OnDetachedFromVisualTree(object? sender, VisualTreeAttachmentEventArgs eventArgs)
    {
        if (Editor.TextArea.TextView.LineTransformers.Contains(_colorizer))
        {
            Editor.TextArea.TextView.LineTransformers.Remove(_colorizer);
        }
    }

    private void OnDocumentChanged(object? sender, EventArgs eventArgs)
    {
        RefreshParserState();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs eventArgs)
    {
        if (eventArgs.PropertyName == nameof(EditorDocumentViewModel.ParserConfig)
            || eventArgs.PropertyName == nameof(EditorDocumentViewModel.EditRestrictionEnabled))
        {
            RefreshParserState();
        }
    }

    private void OnEditorTextAreaKeyDown(object? sender, KeyEventArgs e)
    {
        if (_viewModel is null)
        {
            return;
        }

        if (e.Key == Key.Enter || e.Key == Key.Return)
        {
            e.Handled = _viewModel.EditRestrictionEnabled;
        }
    }

    private void OnEditorTextEntering(object? sender, TextInputEventArgs e)
    {
        if (_viewModel is null || string.IsNullOrEmpty(e.Text))
        {
            return;
        }

        if (_viewModel.TranslationModeEnabled && e.Text == "\\")
        {
            MoveCaretToPreviousTranslatedLine();
            e.Handled = true;
            return;
        }

        if (_viewModel.TranslationModeEnabled && (e.Text.Contains('\n') || e.Text.Contains('\r')))
        {
            MoveCaretToNextTranslatedLine();
            e.Handled = true;
            return;
        }

        if (_viewModel.EditRestrictionEnabled && (e.Text.Contains('\n') || e.Text.Contains('\r')))
        {
            e.Handled = true;
        }
    }

    private void RefreshParserState()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        EnsureEditorHooks();
        var parsedDocument = _parser.Parse(Editor.Document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        _colorizer.Update(parsedDocument);
        ApplyReadOnlySections(parsedDocument);
        Editor.TextArea.TextView.Redraw();
    }

    private void MoveCaretToNextTranslatedLine()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var parsedDocument = _parser.Parse(Editor.Document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var currentLine = Editor.Document.GetLineByOffset(Editor.TextArea.Caret.Offset);
        var currentLineIndex = currentLine.LineNumber - 1;
        if (currentLineIndex < 0)
        {
            currentLineIndex = 0;
        }

        var nextTranslatedLine = parsedDocument.Lines
            .Where(line => line.Kind == ParsedLineKind.Translated && line.LineNumber > currentLineIndex)
            .OrderBy(line => line.LineNumber)
            .FirstOrDefault();

        if (nextTranslatedLine is null)
        {
            return;
        }

        Editor.TextArea.Caret.Offset = nextTranslatedLine.EditableStartOffset;
        var halfHeight = Math.Max(0, Editor.TextArea.Bounds.Height / 2);
        Editor.TextArea.Caret.BringCaretToView(halfHeight);
    }

    private void MoveCaretToPreviousTranslatedLine()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var parsedDocument = _parser.Parse(Editor.Document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var currentLine = Editor.Document.GetLineByOffset(Editor.TextArea.Caret.Offset);
        var currentLineIndex = currentLine.LineNumber - 1;
        if (currentLineIndex < 0)
        {
            currentLineIndex = 0;
        }

        var previousTranslatedLine = parsedDocument.Lines
            .Where(line => line.Kind == ParsedLineKind.Translated && line.LineNumber < currentLineIndex)
            .OrderByDescending(line => line.LineNumber)
            .FirstOrDefault();

        if (previousTranslatedLine is null)
        {
            return;
        }

        Editor.TextArea.Caret.Offset = previousTranslatedLine.EditableStartOffset;
        var halfHeight = Math.Max(0, Editor.TextArea.Bounds.Height / 2);
        Editor.TextArea.Caret.BringCaretToView(halfHeight);
    }

    private void EnsureEditorHooks()
    {
        if (!Editor.TextArea.TextView.LineTransformers.Contains(_colorizer))
        {
            Editor.TextArea.TextView.LineTransformers.Add(_colorizer);
        }
    }
}