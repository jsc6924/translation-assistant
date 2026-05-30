using System;
using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
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

    private void EnsureEditorHooks()
    {
        if (!Editor.TextArea.TextView.LineTransformers.Contains(_colorizer))
        {
            Editor.TextArea.TextView.LineTransformers.Add(_colorizer);
        }
    }
}