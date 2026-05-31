using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using AvaloniaEdit.Document;
using editor.Controls;
using editor.Models;
using editor.Services;
using editor.ViewModels;

namespace editor.Views;

public partial class DocumentEditorView : UserControl
{
    private static readonly Regex TranslationSegmentSeparatorRegex = new(@"[，。、？！…—；：“”‘’~～\s　「」『』\[\]\(\)（）【】{}]+|((\\r)?(\\)?\\n)|<br>", RegexOptions.Compiled);

    private readonly DualLineDocumentParser _parser = new();
    private readonly DualLineColorizer _colorizer = new();
    private readonly TerminologyHighlightService _terminologyHighlightService = new();
    private readonly SimpleTmRemoteClient _simpleTmRemoteClient = new();
    private readonly DispatcherTimer _terminologyTimer;
    private readonly ThickCaretManager _thickCaretManager;
    private EditorDocumentViewModel? _viewModel;
    private IReadOnlyList<TerminologyEntry> _terms = [];
    private IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> _namingRules =
        new Dictionary<string, IReadOnlyDictionary<string, NamingRuleValue>>();
    private TerminologySnapshot _terminologySnapshot = TerminologySnapshot.Empty;
    private IReadOnlyDictionary<int, IReadOnlyList<TerminologyHighlight>> _terminologyHighlightsByLine = new Dictionary<int, IReadOnlyList<TerminologyHighlight>>();
    private DateTime _lastTerminologyFetchUtc = DateTime.MinValue;
    private bool _terminologyFetchInProgress;
    private string? _lastHoverText;
    private bool _altBracketStateValid;
    private int _altBracketLastDistance;
    private bool _suppressAltBracketReset;

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
        Editor.PointerPressed += OnEditorPointerPressed;
        Editor.TextArea.KeyDown += OnEditorTextAreaKeyDown;
        Editor.TextArea.TextEntering += OnEditorTextEntering;
        Editor.TextArea.Caret.PositionChanged += OnCaretPositionChanged;
        Editor.TextArea.AddHandler(InputElement.KeyDownEvent, OnEditorTextAreaKeyDown, RoutingStrategies.Tunnel, true);
        if (Editor.ContextMenu is not null)
        {
            Editor.ContextMenu.Opened += OnEditorContextMenuOpened;
        }
        EnsureEditorHooks();
        _thickCaretManager = new ThickCaretManager(Editor);
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

        if (e.Key == Key.Escape && _viewModel.TranslationModeEnabled)
        {
            SetTranslationMode(false);
            e.Handled = true;
            return;
        }

        if (!_viewModel.TranslationModeEnabled && e.Key == Key.T && e.KeyModifiers == KeyModifiers.Alt)
        {
            SetTranslationMode(true);
            e.Handled = true;
            return;
        }

        var isCtrlBracket = e.KeyModifiers.HasFlag(KeyModifiers.Control) &&
                            (e.Key == Key.OemOpenBrackets || e.Key == Key.OemCloseBrackets);
        if (isCtrlBracket)
        {
            MoveCaretToTextEdge(e.Key == Key.OemCloseBrackets ? 1 : -1);
            ResetAltBracketState();
            e.Handled = true;
            return;
        }

        var isAltBracket = e.KeyModifiers.HasFlag(KeyModifiers.Alt) &&
                           (e.Key == Key.OemOpenBrackets || e.Key == Key.OemCloseBrackets);
        if (isAltBracket)
        {
            MoveCaretWithAltBrackets(e.Key == Key.OemCloseBrackets ? 1 : -1);
            e.Handled = true;
            return;
        }

        ResetAltBracketState();

        if (e.Key == Key.OemPeriod && e.KeyModifiers.HasFlag(KeyModifiers.Control) && e.KeyModifiers.HasFlag(KeyModifiers.Alt))
        {
            if (TryAutoTranslateCurrentLine())
            {
                e.Handled = true;
                return;
            }
        }

        if (_viewModel.TranslationModeEnabled && TryHandleTranslationShortcut(e))
        {
            e.Handled = true;
            return;
        }

        if (_viewModel.TranslationModeEnabled && (e.Key == Key.OemOpenBrackets || e.Key == Key.OemCloseBrackets))
        {
            if (e.KeyModifiers.HasFlag(KeyModifiers.Shift))
            {
                if (e.Key == Key.OemOpenBrackets)
                {
                    MoveCaretToPreviousSegmentInTranslatedLine();
                }
                else
                {
                    MoveCaretToNextSegmentInTranslatedLine();
                }
            }
            else
            {
                MoveCaretInTranslationMode(e.Key == Key.OemCloseBrackets ? 1 : -1);
            }

            e.Handled = true;
            return;
        }

        if (_viewModel.TranslationModeEnabled && e.Key == Key.Tab)
        {
            DeleteToCurrentSegmentEndInTranslatedLine();
            e.Handled = true;
            return;
        }

        if (_viewModel.TranslationModeEnabled && e.Key == Key.Delete)
        {
            DeleteRestOfTranslatedLine();
            e.Handled = true;
            return;
        }

        if (_viewModel.TranslationModeEnabled && e.KeyModifiers.HasFlag(KeyModifiers.Control))
        {
            if (TryInsertCurrentLineTerminologyTranslation(e.Key))
            {
                e.Handled = true;
                return;
            }
        }

        if (_viewModel.TranslationModeEnabled && (e.Key == Key.Enter || e.Key == Key.Return))
        {
            MoveCaretToNextTranslatedLine();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.Enter || e.Key == Key.Return)
        {
            e.Handled = _viewModel.EditRestrictionEnabled;
        }
    }

    private void SetTranslationMode(bool enabled)
    {
        var mainViewModel = FindMainWindowViewModel();
        if (mainViewModel is not null)
        {
            mainViewModel.EnableTranslationMode = enabled;
            return;
        }

        _viewModel!.TranslationModeEnabled = enabled;
    }

    private MainWindowViewModel? FindMainWindowViewModel()
    {
        var owner = this.VisualRoot as Window;
        if (owner is null)
        {
            owner = Application.Current?.ApplicationLifetime is Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime desktop
                ? desktop.MainWindow
                : null;
        }

        return owner?.DataContext as MainWindowViewModel;
    }

    private async void OnEditTerminologyClick(object? sender, RoutedEventArgs e)
    {
        await OpenTerminologyDialogAsync("编辑术语");
    }

    private async void OnCopyTranslationClick(object? sender, RoutedEventArgs e)
    {
        var term = FindSelectedTerm();
        if (term is null || string.IsNullOrWhiteSpace(term.Translation))
        {
            return;
        }

        // 1. 获取当前控件所属的 TopLevel (Window 或 UserControl 的基类)
        // 如果这段代码在 Window/UserControl 的后端(Code-behind)里，直接传 this 即可
        var topLevel = Avalonia.Controls.TopLevel.GetTopLevel(this);

        // 安全兜底：如果是在外部类，可以通过点击事件的触发者(sender)来抓取顶级容器
        // var topLevel = Avalonia.Controls.TopLevel.GetTopLevel(sender as Avalonia.Visual);

        if (topLevel?.Clipboard is { } clipboard)
        {
            // 2. Avalonia 11 直接调用实例方法即可，不再需要额外的 ClipboardExtensions 扩展类
            await clipboard.SetTextAsync(term.Translation.Trim());
        }
    }

    private void OnEditorContextMenuOpened(object? sender, EventArgs e)
    {
        var copyMenuItem = CopyTranslationMenuItem;
        if (copyMenuItem is not null)
        {
            var term = FindSelectedTerm();
            var canCopyTranslation = term is not null && !string.IsNullOrWhiteSpace(term.Translation);
            copyMenuItem.IsVisible = canCopyTranslation;
            copyMenuItem.IsEnabled = canCopyTranslation;
        }

        var editMenuItem = EditTerminologyMenuItem;
        if (editMenuItem is not null)
        {
            var selectedText = GetSelectedText();
            var canEditTerminology = !string.IsNullOrWhiteSpace(selectedText);
            editMenuItem.IsVisible = canEditTerminology;
            editMenuItem.IsEnabled = canEditTerminology;
        }

        var formatMenuItem = FormatTextMenuItem;
        if (formatMenuItem is not null)
        {
            formatMenuItem.IsVisible = Editor.Document is not null;
            formatMenuItem.IsEnabled = Editor.Document is not null;
        }
    }

    private async void OnFormatTextClick(object? sender, RoutedEventArgs e)
    {
        if (Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        var documentText = document.Text ?? string.Empty;
        var parsedDocument = _parser.Parse(documentText, _viewModel?.ParserConfig ?? ParserConfig.Default(), true);
        if (!parsedDocument.IsConfigured)
        {
            return;
        }

        var selectionStart = Editor.SelectionStart;
        var selectionLength = Editor.SelectionLength;
        var replacements = GetTranslatedLineReplacements(document, parsedDocument, selectionStart, selectionLength);
        if (replacements.Count == 0)
        {
            return;
        }

        for (var i = replacements.Count - 1; i >= 0; i--)
        {
            var replacement = replacements[i];
            document.Replace(replacement.Offset, replacement.Length, replacement.NewText);
        }
    }

    private static IReadOnlyList<(int Offset, int Length, string NewText)> GetTranslatedLineReplacements(
        TextDocument document,
        ParsedDocument parsedDocument,
        int selectionStart,
        int selectionLength)
    {
        var replacements = new List<(int Offset, int Length, string NewText)>();
        var selectionEnd = selectionStart + selectionLength;
        var hasSelection = selectionLength > 0;

        foreach (var lineInfo in parsedDocument.Lines)
        {
            if (lineInfo.Kind != ParsedLineKind.Translated)
            {
                continue;
            }

            var line = document.GetLineByNumber(lineInfo.LineNumber + 1);
            var lineOffset = line.Offset;
            var lineLength = line.Length;
            if (hasSelection)
            {
                if (selectionEnd <= lineOffset || selectionStart >= lineOffset + lineLength)
                {
                    continue;
                }
            }

            var lineText = document.GetText(lineOffset, lineLength);
            var formattedText = FormatText(lineText);
            if (formattedText != lineText)
            {
                replacements.Add((lineOffset, lineLength, formattedText));
            }
        }

        return replacements;
    }

    private static string FormatText(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return text;
        }

        text = Regex.Replace(text, @"\.{2,}", "……");
        text = Regex.Replace(text, @"。{2,}", "……");
        text = Regex.Replace(text, @"[~∼〜]+", "～");
        text = Regex.Replace(text, @"[ー－-]{2,}", "————");
        text = Regex.Replace(text, @"……。", "……");
        text = Regex.Replace(text, @"。」", "」");
        return text;
    }

    private TerminologyEntry? FindSelectedTerm()
    {
        var selectedText = GetSelectedText();
        if (selectedText is null)
        {
            return null;
        }

        return _terms.FirstOrDefault(term => string.Equals(term.Raw, selectedText, StringComparison.Ordinal));
    }

    private void MoveCaretInTranslationMode(int delta)
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        var currentOffset = Editor.TextArea.Caret.Offset;
        var nextOffset = currentOffset + delta;
        nextOffset = Math.Max(0, Math.Min(document.Text.Length, nextOffset));

        if (_viewModel.TranslationModeEnabled)
        {
            var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
            var currentLine = document.GetLineByOffset(currentOffset);
            var expectedLineNumber = currentLine.LineNumber - 1;
            var lineInfo = parsedDocument.GetLine(expectedLineNumber);
            if (lineInfo is not null && lineInfo.Kind == ParsedLineKind.Translated)
            {
                var minOffset = lineInfo.EditableStartOffset;
                var maxOffset = lineInfo.EditableStartOffset + lineInfo.EditableLength;
                nextOffset = Math.Max(minOffset, Math.Min(maxOffset, nextOffset));
            }
        }

        Editor.TextArea.Caret.Offset = nextOffset;
    }

    private void MoveCaretToNextSegmentInTranslatedLine()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        var currentOffset = Editor.TextArea.Caret.Offset;
        var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var currentLine = document.GetLineByOffset(currentOffset);
        var lineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind != ParsedLineKind.Translated)
        {
            return;
        }

        var editableStart = lineInfo.EditableStartOffset;
        var editableEnd = editableStart + lineInfo.EditableLength;
        if (currentOffset < editableStart)
        {
            currentOffset = editableStart;
        }

        if (currentOffset >= editableEnd)
        {
            return;
        }

        var relativePosition = currentOffset - editableStart;
        var text = document.GetText(editableStart, lineInfo.EditableLength);
        var searchText = text.Substring(relativePosition);
        var match = TranslationSegmentSeparatorRegex.Match(searchText);
        if (!match.Success)
        {
            Editor.TextArea.Caret.Offset = editableEnd;
            Editor.TextArea.Caret.BringCaretToView();
            return;
        }

        var segmentHeadOffset = editableStart + relativePosition + match.Index + match.Length;
        if (segmentHeadOffset > editableEnd)
        {
            segmentHeadOffset = editableEnd;
        }

        if (segmentHeadOffset <= currentOffset)
        {
            Editor.TextArea.Caret.Offset = editableEnd;
            Editor.TextArea.Caret.BringCaretToView();
            return;
        }

        Editor.TextArea.Caret.Offset = segmentHeadOffset;
        Editor.TextArea.Caret.BringCaretToView();
    }

    private void MoveCaretWithAltBrackets(int direction)
    {
        if (Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        if (document.TextLength == 0)
        {
            return;
        }

        var currentOffset = Editor.TextArea.Caret.Offset;
        var currentLine = document.GetLineByOffset(currentOffset);
        var parsedDocument = _parser.Parse(document.Text, _viewModel?.ParserConfig ?? ParserConfig.Default(), _viewModel?.EditRestrictionEnabled ?? false);
        var lineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind != ParsedLineKind.Translated || lineInfo.EditableLength <= 0)
        {
            return;
        }

        var textStart = lineInfo.EditableStartOffset;
        var textEnd = lineInfo.EditableStartOffset + lineInfo.EditableLength;
        var current = Math.Min(Math.Max(currentOffset, textStart), textEnd);
        var distanceToEdge = direction > 0
            ? textEnd - current
            : current - textStart;

        if (distanceToEdge <= 0)
        {
            return;
        }

        var moveDistance = _altBracketStateValid
            ? Math.Max(1, _altBracketLastDistance / 2)
            : Math.Max(1, distanceToEdge / 2);

        _altBracketLastDistance = moveDistance;
        _altBracketStateValid = true;

        var nextOffset = direction > 0
            ? Math.Min(textEnd, current + moveDistance)
            : Math.Max(textStart, current - moveDistance);

        _suppressAltBracketReset = true;
        Editor.TextArea.Caret.Offset = nextOffset;
        Editor.TextArea.Caret.BringCaretToView();
        _suppressAltBracketReset = false;
    }

    private void MoveCaretToTextEdge(int direction)
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        if (document.TextLength == 0)
        {
            return;
        }

        var currentOffset = Editor.TextArea.Caret.Offset;
        var currentLine = document.GetLineByOffset(currentOffset);
        var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var lineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind != ParsedLineKind.Translated || lineInfo.EditableLength <= 0)
        {
            return;
        }

        var textStart = lineInfo.EditableStartOffset;
        var textEnd = lineInfo.EditableStartOffset + lineInfo.EditableLength;
        var nextOffset = direction > 0 ? textEnd : textStart;

        _suppressAltBracketReset = true;
        Editor.TextArea.Caret.Offset = nextOffset;
        Editor.TextArea.Caret.BringCaretToView();
        _suppressAltBracketReset = false;
    }

    private void ResetAltBracketState()
    {
        _altBracketStateValid = false;
        _altBracketLastDistance = 0;
    }

    private void OnCaretPositionChanged(object? sender, EventArgs e)
    {
        if (_suppressAltBracketReset)
        {
            return;
        }

        ResetAltBracketState();
    }

    private void OnEditorPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        ResetAltBracketState();
    }

    private void MoveCaretToPreviousSegmentInTranslatedLine()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        var currentOffset = Editor.TextArea.Caret.Offset;
        var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var currentLine = document.GetLineByOffset(currentOffset);
        var lineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind != ParsedLineKind.Translated)
        {
            return;
        }

        var editableStart = lineInfo.EditableStartOffset;
        var editableEnd = editableStart + lineInfo.EditableLength;
        if (currentOffset <= editableStart)
        {
            return;
        }

        var relativePosition = currentOffset - editableStart;
        var text = document.GetText(editableStart, lineInfo.EditableLength);
        var prefixText = text.Substring(0, Math.Min(relativePosition, text.Length));
        var matches = TranslationSegmentSeparatorRegex.Matches(prefixText);
        if (matches.Count == 0)
        {
            return;
        }

        var lastMatch = matches[^1];
        var segmentHeadOffset = editableStart + lastMatch.Index + lastMatch.Length;
        if (segmentHeadOffset >= currentOffset)
        {
            if (matches.Count < 2)
            {
                segmentHeadOffset = editableStart;
            }
            else
            {
                lastMatch = matches[^2];
                segmentHeadOffset = editableStart + lastMatch.Index + lastMatch.Length;
            }
        }

        if (segmentHeadOffset < editableStart)
        {
            segmentHeadOffset = editableStart;
        }

        Editor.TextArea.Caret.Offset = segmentHeadOffset;
        Editor.TextArea.Caret.BringCaretToView();
    }

    private void DeleteToCurrentSegmentEndInTranslatedLine()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        var currentOffset = Editor.TextArea.Caret.Offset;
        var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var currentLine = document.GetLineByOffset(currentOffset);
        var lineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind != ParsedLineKind.Translated)
        {
            return;
        }

        var editableStart = lineInfo.EditableStartOffset;
        var editableEnd = editableStart + lineInfo.EditableLength;
        if (currentOffset < editableStart || currentOffset >= editableEnd)
        {
            return;
        }

        var relativePosition = currentOffset - editableStart;
        var text = document.GetText(editableStart, lineInfo.EditableLength);
        var searchText = text.Substring(relativePosition);
        var match = TranslationSegmentSeparatorRegex.Match(searchText);
        var deleteEndOffset = editableEnd;
        if (match.Success)
        {
            if (match.Index == 0)
            {
                deleteEndOffset = editableStart + relativePosition + match.Length;
            }
            else
            {
                deleteEndOffset = editableStart + relativePosition + match.Index;
            }
        }

        if (deleteEndOffset <= currentOffset)
        {
            return;
        }

        document.Replace(currentOffset, deleteEndOffset - currentOffset, string.Empty);
    }

    private void DeleteRestOfTranslatedLine()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return;
        }

        var document = Editor.Document;
        var currentOffset = Editor.TextArea.Caret.Offset;
        var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var currentLine = document.GetLineByOffset(currentOffset);
        var lineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind != ParsedLineKind.Translated)
        {
            return;
        }

        var editableStart = lineInfo.EditableStartOffset;
        var editableEnd = editableStart + lineInfo.EditableLength;
        if (currentOffset < editableStart || currentOffset >= editableEnd)
        {
            return;
        }

        document.Replace(currentOffset, editableEnd - currentOffset, string.Empty);
    }

    private bool TryAutoTranslateCurrentLine()
    {
        if (_viewModel is null || Editor.Document is null)
        {
            return false;
        }

        var document = Editor.Document;
        var currentOffset = Editor.TextArea.Caret.Offset;
        var currentLine = document.GetLineByOffset(currentOffset);
        var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var lineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind != ParsedLineKind.Translated || lineInfo.EditableLength <= 0)
        {
            return false;
        }

        var editableStart = lineInfo.EditableStartOffset;
        var editableLength = lineInfo.EditableLength;
        var editableText = document.GetText(editableStart, editableLength);
        var translatedText = AutoTranslateText(editableText);
        if (translatedText == editableText)
        {
            return false;
        }

        document.Replace(editableStart, editableLength, translatedText);
        return true;
    }

    private static string AutoTranslateText(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return text;
        }

        foreach (var rule in AutoTranslationRules)
        {
            text = rule.Pattern.Replace(text, rule.Replace);
        }

        return text;
    }

    private static readonly IReadOnlyList<(Regex Pattern, MatchEvaluator Replace)> AutoTranslationRules = new (Regex Pattern, MatchEvaluator Replace)[]
    {
        (new Regex("[っ゛]", RegexOptions.Compiled), _ => string.Empty),
        (new Regex("だめ", RegexOptions.Compiled), _ => "不行"),
        (new Regex("[れぺ]ぇ?[ろる]+", RegexOptions.Compiled), m => "啾" + RepeatStr("噜", m.Value.Length - 1, false)),
        (new Regex("[ぴぷ]ち[ゃゅ]", RegexOptions.Compiled), _ => "噗啾"),
        (new Regex("[ちじぢ]ゅ[ぷぶぽぼ]+", RegexOptions.Compiled), m => "啾" + RepeatStr("噗", Math.Max(0, m.Value.Length - 2), false)),
        (new Regex("[ちじぢ]ゅ[うぅ]?", RegexOptions.Compiled), _ => "啾"),
        (new Regex("りゅ", RegexOptions.Compiled), _ => "噜"),
        (new Regex("[こご]くん", RegexOptions.Compiled), _ => "咕噜"),
        (new Regex("ど?[びぴ]ゅる+[うぅ]*", RegexOptions.Compiled), m => "咻" + RepeatStr("噜", Math.Max(0, m.Value.Length - 1), true)),
        (new Regex("ど?[びぴ]ゅ(く[うぅ]*)?", RegexOptions.Compiled), m => RepeatStr("咻", m.Value.Length, false)),
        (new Regex("ど[ぷく]+", RegexOptions.Compiled), m => "咻" + RepeatStr("噗", Math.Max(0, m.Value.Length - 1), false)),
        (new Regex("や[あぁ]*", RegexOptions.Compiled), m => "呀" + RepeatStr("啊", Math.Max(0, m.Value.Length - 1), true)),
        (new Regex("[あぁ]+", RegexOptions.Compiled), m => RepeatStr("啊", m.Value.Length, true)),
        (new Regex("[おぉ]+", RegexOptions.Compiled), m => RepeatStr("哦", m.Value.Length, false)),
        (new Regex("ず+", RegexOptions.Compiled), m => RepeatStr("滋", m.Value.Length, false)),
        (new Regex("ふ+", RegexOptions.Compiled), m => RepeatStr("呼", m.Value.Length, false)),
        (new Regex("ふう?", RegexOptions.Compiled), _ => "呼"),
        (new Regex("う(?=あ)", RegexOptions.Compiled), _ => "哇"),
        (new Regex("[うぅ]+", RegexOptions.Compiled), m => RepeatStr("呜", m.Value.Length, false)),
        (new Regex("[ひき][ゃぃ]?", RegexOptions.Compiled), _ => "呀"),
        (new Regex("く", RegexOptions.Compiled), _ => "咕"),
        (new Regex("ぐ", RegexOptions.Compiled), _ => "咕"),
        (new Regex("ぬ", RegexOptions.Compiled), _ => "呶"),
        (new Regex("ぱ[ん]?", RegexOptions.Compiled), _ => "啪"),
        (new Regex("は[ん]?", RegexOptions.Compiled), _ => "哈"),
        (new Regex("[ぷぶ][ん]?", RegexOptions.Compiled), _ => "噗"),
        (new Regex("む[ん]?", RegexOptions.Compiled), _ => "姆"),
        (new Regex("る", RegexOptions.Compiled), _ => "噜"),
        (new Regex("ん+ぅ*", RegexOptions.Compiled), m => RepeatStr("嗯", m.Value.Length, true)),
        (new Regex("～、", RegexOptions.Compiled), _ => "～"),
        (new Regex("嗯呜", RegexOptions.Compiled), _ => "嗯"),
        (new Regex("呼呜", RegexOptions.Compiled), _ => "呼"),
    };

    private static string RepeatStr(string text, int count, bool addSuffix)
    {
        if (count <= 0)
        {
            return string.Empty;
        }

        if (addSuffix && count >= 3)
        {
            var suffixCount = count / 3;
            var repeatCount = count - suffixCount;
            return string.Concat(Enumerable.Repeat(text, repeatCount)) + string.Concat(Enumerable.Repeat("～", suffixCount));
        }

        return string.Concat(Enumerable.Repeat(text, count));
    }

    private bool TryInsertCurrentLineTerminologyTranslation(Key key)
    {
        var ordinal = GetNumberKey(key);
        if (ordinal <= 0 || _viewModel is null || Editor.Document is null)
        {
            return false;
        }

        var document = Editor.Document;
        var currentOffset = Editor.TextArea.Caret.Offset;
        var currentLine = document.GetLineByOffset(currentOffset);
        var parsedDocument = _parser.Parse(document.Text, _viewModel.ParserConfig, _viewModel.EditRestrictionEnabled);
        var translatedLineInfo = parsedDocument.GetLine(currentLine.LineNumber - 1);
        if (translatedLineInfo is null || translatedLineInfo.Kind != ParsedLineKind.Translated)
        {
            return false;
        }

        var originalLineInfo = translatedLineInfo.LineNumber > 0
            ? parsedDocument.GetLine(translatedLineInfo.LineNumber - 1)
            : null;
        if (originalLineInfo is null || originalLineInfo.Kind != ParsedLineKind.Original)
        {
            return false;
        }

        var originalTextLine = document.GetLineByNumber(originalLineInfo.LineNumber + 1);
        var originalStartOffset = originalTextLine.Offset;
        var originalEndOffset = originalStartOffset + originalTextLine.Length;
        if (originalEndOffset <= originalStartOffset)
        {
            return false;
        }

        var termMap = _terms.ToDictionary(term => term.Raw, term => term.Translation, StringComparer.Ordinal);
        var invertedNamingMap = BuildInvertedNamingMap(_namingRules);
        var candidates = new List<(int Offset, string Translation)>();

        if (_terminologyHighlightsByLine.TryGetValue(originalLineInfo.LineNumber, out var highlights))
        {
            foreach (var highlight in highlights)
            {
                var raw = document.GetText(highlight.StartOffset, highlight.Length);
                var translation = highlight.IsNaming
                    ? ResolveNamingTranslation(raw, originalLineInfo.Name, _namingRules, invertedNamingMap)
                    : termMap.TryGetValue(raw, out var termTranslation) ? termTranslation : string.Empty;

                if (string.IsNullOrWhiteSpace(translation))
                {
                    continue;
                }

                candidates.Add((highlight.StartOffset, translation.Trim()));
            }
        }

        if (ordinal > candidates.Count)
        {
            return false;
        }

        var selectedTranslation = candidates
            .OrderBy(candidate => candidate.Offset)
            .ElementAt(ordinal - 1)
            .Translation;

        document.Insert(currentOffset, selectedTranslation);
        Editor.TextArea.Caret.Offset = currentOffset + selectedTranslation.Length;
        Editor.TextArea.Caret.BringCaretToView();
        return true;
    }

    private bool TryHandleTranslationShortcut(KeyEventArgs e)
    {
        if (_viewModel is null || !_viewModel.TranslationModeEnabled || Editor.Document is null)
        {
            return false;
        }

        if (e.KeyModifiers != KeyModifiers.None
            && !(e.Key == Key.Oem3 && e.KeyModifiers == KeyModifiers.Shift))
        {
            return false;
        }

        var text = e.Key switch
        {
            Key.F1 => "1",
            Key.F2 => "2",
            Key.F3 => "3",
            Key.F4 => "4",
            Key.F5 => "5",
            Key.F6 => "6",
            Key.F7 => "7",
            Key.F8 => "8",
            Key.F9 => "9",
            Key.F10 => "0",
            Key.Oem3 when e.KeyModifiers == KeyModifiers.Shift => "～",
            Key.D1 or Key.NumPad1 => "！",
            Key.D2 or Key.NumPad2 => "♪",
            Key.D3 or Key.NumPad3 => "？",
            Key.D4 or Key.NumPad4 => "、",
            Key.D5 or Key.NumPad5 => "♥",
            Key.D6 or Key.NumPad6 => "……",
            Key.OemMinus or Key.Subtract => "——",
            Key.Space => "　",
            _ => null,
        };

        if (text is null)
        {
            return false;
        }

        var document = Editor.Document;
        if (Editor.SelectionLength > 0)
        {
            document.Remove(Editor.SelectionStart, Editor.SelectionLength);
        }

        var currentOffset = Editor.TextArea.Caret.Offset;
        document.Insert(currentOffset, text);
        Editor.TextArea.Caret.Offset = currentOffset + text.Length;
        Editor.TextArea.Caret.BringCaretToView();
        return true;
    }

    private static int GetNumberKey(Key key)
    {
        return key switch
        {
            Key.D1 or Key.NumPad1 => 1,
            Key.D2 or Key.NumPad2 => 2,
            Key.D3 or Key.NumPad3 => 3,
            Key.D4 or Key.NumPad4 => 4,
            Key.D5 or Key.NumPad5 => 5,
            Key.D6 or Key.NumPad6 => 6,
            Key.D7 or Key.NumPad7 => 7,
            Key.D8 or Key.NumPad8 => 8,
            Key.D9 or Key.NumPad9 => 9,
            _ => 0,
        };
    }

    private static string ResolveNamingTranslation(
        string called,
        string? callerName,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> namingRules,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> invertedNamingMap)
    {
        const string MatchAnyTalker = "*";

        if (!string.IsNullOrWhiteSpace(callerName)
            && namingRules.TryGetValue(callerName, out var directRules)
            && directRules.TryGetValue(called, out var directRule))
        {
            return GetNamingRuleTranslation(directRule);
        }

        if (namingRules.TryGetValue(MatchAnyTalker, out var wildcardRules)
            && wildcardRules.TryGetValue(called, out var wildcardRule))
        {
            return GetNamingRuleTranslation(wildcardRule);
        }

        if (!invertedNamingMap.TryGetValue(called, out var callerMap))
        {
            return string.Empty;
        }

        foreach (var rule in callerMap.Values)
        {
            var translation = GetNamingRuleTranslation(rule);
            if (!string.IsNullOrWhiteSpace(translation))
            {
                return translation;
            }
        }

        return string.Empty;
    }

    private static string GetNamingRuleTranslation(NamingRuleValue ruleValue)
    {
        return (ruleValue.Transcaller ?? string.Empty).Replace("\"", string.Empty, StringComparison.Ordinal);
    }

    private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> BuildInvertedNamingMap(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> namingRules)
    {
        var inverted = new Dictionary<string, Dictionary<string, NamingRuleValue>>(StringComparer.Ordinal);
        foreach (var (caller, calledMap) in namingRules)
        {
            foreach (var (called, ruleValue) in calledMap)
            {
                if (!inverted.TryGetValue(called, out var callerMap))
                {
                    callerMap = new Dictionary<string, NamingRuleValue>(StringComparer.Ordinal);
                    inverted[called] = callerMap;
                }

                callerMap[caller] = ruleValue;
            }
        }

        return inverted.ToDictionary(pair => pair.Key, pair => (IReadOnlyDictionary<string, NamingRuleValue>)pair.Value, StringComparer.Ordinal);
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

        if (_viewModel.TranslationModeEnabled && e.Text == "\\")
        {
            MoveCaretToPreviousTranslatedLine();
            e.Handled = true;
            return;
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
        var lineNumberToTalker = parsedDocument.Lines
            .Where(line => !string.IsNullOrWhiteSpace(line.Name))
            .ToDictionary(line => line.LineNumber, line => line.Name);
        _terminologySnapshot = _terminologyHighlightService.Build(Editor.Document.Text, _terms, _namingRules, lineNumberToTalker);
        _terminologyHighlightsByLine = BuildTerminologyHighlightsByLine(Editor.Document, _terminologySnapshot);
        _colorizer.Update(parsedDocument, _terminologySnapshot);
        ApplyReadOnlySections(parsedDocument);
        Editor.TextArea.TextView.Redraw();
    }

    private static IReadOnlyDictionary<int, IReadOnlyList<TerminologyHighlight>> BuildTerminologyHighlightsByLine(
        TextDocument document,
        TerminologySnapshot terminologySnapshot)
    {
        var index = new Dictionary<int, List<TerminologyHighlight>>();
        foreach (var highlight in terminologySnapshot.Highlights)
        {
            var lineNumber = document.GetLineByOffset(highlight.StartOffset).LineNumber - 1;
            if (!index.TryGetValue(lineNumber, out var highlights))
            {
                highlights = new List<TerminologyHighlight>();
                index[lineNumber] = highlights;
            }

            highlights.Add(highlight);
        }

        return index.ToDictionary(pair => pair.Key, pair => (IReadOnlyList<TerminologyHighlight>)pair.Value);
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
            if (!force)
            {
                return;
            }

            while (_terminologyFetchInProgress)
            {
                await System.Threading.Tasks.Task.Delay(50).ConfigureAwait(false);
            }
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
        _terminologyHighlightsByLine = new Dictionary<int, IReadOnlyList<TerminologyHighlight>>();
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

    private async System.Threading.Tasks.Task OpenTerminologyDialogAsync(string title)
    {
        if (_viewModel is null)
        {
            return;
        }

        var rawText = GetSelectedText();
        if (string.IsNullOrWhiteSpace(rawText))
        {
            ToolTip.SetTip(Editor, "请先选中要添加/编辑/删除的术语文本。");
            return;
        }

        var sharedUrl = _viewModel.SimpleTmSharedUrl?.Trim();
        if (string.IsNullOrWhiteSpace(sharedUrl))
        {
            ToolTip.SetTip(Editor, "请先配置 simpleTmSharedUrl，然后再操作术语。");
            return;
        }

        var existingTranslation = _terms.FirstOrDefault(term => string.Equals(term.Raw, rawText, StringComparison.Ordinal))?.Translation ?? string.Empty;
        var dialog = new TerminologyEditorWindow(rawText, existingTranslation)
        {
            Title = title,
        };

        var owner = this.VisualRoot as Window;
        if (owner is null)
        {
            owner = Application.Current?.ApplicationLifetime is Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime desktop
                ? desktop.MainWindow
                : null;
        }

        if (owner is null)
        {
            ToolTip.SetTip(Editor, "无法找到窗口父级，无法打开术语编辑窗口。");
            return;
        }

        var confirmed = await dialog.ShowDialog<bool?>(owner) ?? false;
        if (!confirmed)
        {
            return;
        }

        try
        {
            if (string.IsNullOrWhiteSpace(dialog.Translation))
            {
                await _simpleTmRemoteClient.DeleteTermAsync(sharedUrl, rawText);
                ToolTip.SetTip(Editor, $"已删除术语：{rawText}");
            }
            else
            {
                await _simpleTmRemoteClient.UpdateTermAsync(sharedUrl, rawText, dialog.Translation.Trim());
                ToolTip.SetTip(Editor, $"已保存术语：{rawText}");
            }

            await RefreshTerminologyFromServerAsync(force: true);
        }
        catch (Exception exception)
        {
            ToolTip.SetTip(Editor, $"术语操作失败：{exception.Message}");
        }
    }

    private string? GetSelectedText()
    {
        if (Editor.Document is null)
        {
            return null;
        }

        var selectedText = Editor.SelectedText?.Trim();
        return string.IsNullOrWhiteSpace(selectedText) ? null : selectedText;
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