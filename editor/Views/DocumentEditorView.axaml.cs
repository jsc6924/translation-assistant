using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;
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
    private readonly TerminologyHighlightService _terminologyHighlightService = new();
    private readonly SimpleTmRemoteClient _simpleTmRemoteClient = new();
    private readonly DispatcherTimer _terminologyTimer;
    private EditorDocumentViewModel? _viewModel;
    private IReadOnlyList<TerminologyEntry> _terms = [];
    private IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> _namingRules =
        new Dictionary<string, IReadOnlyDictionary<string, NamingRuleValue>>();
    private TerminologySnapshot _terminologySnapshot = TerminologySnapshot.Empty;
    private DateTime _lastTerminologyFetchUtc = DateTime.MinValue;
    private bool _terminologyFetchInProgress;
    private string? _lastHoverText;

    public DocumentEditorView()
    {
        InitializeComponent();
        _terminologyTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(30),
        };
        _terminologyTimer.Tick += OnTerminologyTimerTick;

        Editor.Document = new TextDocument();
        DataContextChanged += OnDataContextChanged;
        AttachedToVisualTree += OnAttachedToVisualTree;
        DetachedFromVisualTree += OnDetachedFromVisualTree;
        Editor.PointerMoved += OnEditorPointerMoved;
        Editor.PointerExited += OnEditorPointerExited;
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
            ResetTerminologyState();
            _colorizer.Update(new ParsedDocument(false), TerminologySnapshot.Empty);
            Editor.TextArea.ReadOnlySectionProvider = AllowAllReadOnlySectionProvider.Instance;
            Editor.TextArea.TextView.Redraw();
            return;
        }

        Editor.Document = _viewModel.Document;
        EnsureEditorHooks();
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.Document.Changed += OnDocumentChanged;
        RefreshParserState();
        _ = RefreshTerminologyFromServerAsync(force: true);
    }

    private void OnAttachedToVisualTree(object? sender, VisualTreeAttachmentEventArgs eventArgs)
    {
        EnsureEditorHooks();
        _terminologyTimer.Start();
        RefreshParserState();
        _ = RefreshTerminologyFromServerAsync(force: true);
    }

    private void OnDetachedFromVisualTree(object? sender, VisualTreeAttachmentEventArgs eventArgs)
    {
        _terminologyTimer.Stop();
        _lastHoverText = null;
        ToolTip.SetTip(Editor, null);
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
            || eventArgs.PropertyName == nameof(EditorDocumentViewModel.EditRestrictionEnabled)
            || eventArgs.PropertyName == nameof(EditorDocumentViewModel.SimpleTmSharedUrl))
        {
            RefreshParserState();
            _ = RefreshTerminologyFromServerAsync(force: true);
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
        _terminologySnapshot = _terminologyHighlightService.Build(Editor.Document.Text, _terms, _namingRules);
        var parsedDocument = _parser.Parse(Editor.Document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        _colorizer.Update(parsedDocument, _terminologySnapshot);
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

    private async void OnTerminologyTimerTick(object? sender, EventArgs e)
    {
        await RefreshTerminologyFromServerAsync(force: false);
    }

    private async System.Threading.Tasks.Task RefreshTerminologyFromServerAsync(bool force)
    {
        if (_viewModel is null)
        {
            return;
        }

        var sharedUrl = _viewModel.SimpleTmSharedUrl?.Trim();
        if (string.IsNullOrWhiteSpace(sharedUrl))
        {
            if (_terms.Count > 0 || _namingRules.Count > 0)
            {
                ResetTerminologyState();
                RefreshParserState();
            }

            return;
        }

        if (_terminologyFetchInProgress)
        {
            return;
        }

        if (!force && DateTime.UtcNow - _lastTerminologyFetchUtc < TimeSpan.FromSeconds(30))
        {
            return;
        }

        _terminologyFetchInProgress = true;
        try
        {
            var (terms, namingRules) = await _simpleTmRemoteClient.FetchAsync(sharedUrl);
            _lastTerminologyFetchUtc = DateTime.UtcNow;
            _terms = terms;
            _namingRules = namingRules;
            RefreshParserState();
        }
        catch
        {
            // Ignore terminology sync failures to keep editor responsive.
        }
        finally
        {
            _terminologyFetchInProgress = false;
        }
    }

    private void ResetTerminologyState()
    {
        _terms = [];
        _namingRules = new Dictionary<string, IReadOnlyDictionary<string, NamingRuleValue>>();
        _terminologySnapshot = TerminologySnapshot.Empty;
        _lastTerminologyFetchUtc = DateTime.MinValue;
        _lastHoverText = null;
        ToolTip.SetTip(Editor, null);
    }

    private void OnEditorPointerMoved(object? sender, PointerEventArgs e)
    {
        if (_terminologySnapshot.Highlights.Count == 0 || Editor.Document is null)
        {
            if (_lastHoverText is not null)
            {
                _lastHoverText = null;
                ToolTip.SetTip(Editor, null);
            }

            return;
        }

        var offset = TryGetOffsetAtPointer(e);
        if (offset is null)
        {
            if (_lastHoverText is not null)
            {
                _lastHoverText = null;
                ToolTip.SetTip(Editor, null);
            }

            return;
        }

        var highlight = _terminologySnapshot.FindByOffset(offset.Value);
        var hoverText = highlight?.HoverText;
        if (string.Equals(_lastHoverText, hoverText, StringComparison.Ordinal))
        {
            return;
        }

        _lastHoverText = hoverText;
        ToolTip.SetTip(Editor, hoverText);
    }

    private void OnEditorPointerExited(object? sender, PointerEventArgs e)
    {
        _lastHoverText = null;
        ToolTip.SetTip(Editor, null);
    }

    private int? TryGetOffsetAtPointer(PointerEventArgs e)
    {
        if (Editor.Document is null)
        {
            return null;
        }

        try
        {
            var point = e.GetPosition(Editor);
            var position = Editor.GetPositionFromPoint(point);
            if (!position.HasValue)
            {
                return null;
            }

            var offset = Editor.Document.GetOffset(position.Value.Location);
            // GetPositionFromPoint(point) 有时候会返回光标所在位置的下一个字符 offset，尤其是鼠标靠近高亮右边界时。这样就会导致你本来在高亮范围内，但 FindByOffset(offset) 返回 null。
            if (_terminologySnapshot.FindByOffset(offset) is null && offset > 0)
            {
                var previous = offset - 1;
                if (_terminologySnapshot.FindByOffset(previous) is not null)
                {
                    return previous;
                }
            }

            return offset;
        }
        catch
        {
            return null;
        }
    }

    private void EnsureEditorHooks()
    {
        if (!Editor.TextArea.TextView.LineTransformers.Contains(_colorizer))
        {
            Editor.TextArea.TextView.LineTransformers.Add(_colorizer);
        }
    }
}