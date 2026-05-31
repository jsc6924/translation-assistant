using System;
using System.IO;
using System.Text;
using Avalonia;
using Avalonia.Media;
using AvaloniaEdit.Document;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using editor.Models;
using Ude;

namespace editor.ViewModels;

public partial class EditorDocumentViewModel : ViewModelBase, IDisposable
{
    private readonly Action<EditorDocumentViewModel> _closeRequested;
    private Encoding _fileEncoding = new UTF8Encoding(false);
    private string _encodingName = "UTF8";

    [ObservableProperty]
    private bool _isDirty;

    [ObservableProperty]
    private ParserConfig _parserConfig;

    [ObservableProperty]
    private bool _editRestrictionEnabled = true;

    [ObservableProperty]
    private bool _translationModeEnabled;

    [ObservableProperty]
    private string _simpleTmSharedUrl = string.Empty;

    [ObservableProperty]
    private FontFamily _fontFamily = new("Microsoft YaHei");

    [ObservableProperty]
    private double _fontSize = 14;

    public EditorDocumentViewModel(
        string filePath,
        string content,
        ParserConfig parserConfig,
        Action<EditorDocumentViewModel> closeRequested)
    {
        FilePath = filePath;
        Document = new TextDocument(content);
        _parserConfig = parserConfig.Clone();
        _closeRequested = closeRequested;
        CloseCommand = new RelayCommand(() => _closeRequested(this));
        Document.Changed += OnDocumentChanged;
    }

    public string FilePath { get; private set; }

    public string DisplayName => Path.GetFileName(FilePath);

    public string Header => IsDirty ? $"{DisplayName} *" : DisplayName;

    public string EncodingName => _encodingName;

    public Encoding FileEncoding => _fileEncoding;

    public Vector SavedScrollOffset { get; set; } = Vector.Zero;

    public int SavedCaretOffset { get; set; }

    public void UpdateFilePath(string newPath)
    {
        FilePath = newPath;
        OnPropertyChanged(nameof(FilePath));
        OnPropertyChanged(nameof(DisplayName));
        OnPropertyChanged(nameof(Header));
    }

    public string ToolTip => FilePath;

    public TextDocument Document { get; }

    public IRelayCommand CloseCommand { get; }

    public void ApplyParserConfig(ParserConfig parserConfig)
    {
        ParserConfig = parserConfig.Clone();
    }

    public void ApplyEditorFontSettings(FontFamily fontFamily, double fontSize)
    {
        FontFamily = fontFamily;
        FontSize = fontSize;
    }

    public bool SaveIfDirty(out string? error)
    {
        if (!IsDirty)
        {
            error = null;
            return true;
        }

        return Save(out error);
    }

    public bool Save(out string? error)
    {
        try
        {
            File.WriteAllText(FilePath, Document.Text, _fileEncoding);
            IsDirty = false;
            error = null;
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    public void ReloadContent(string content, Encoding encoding, string encodingName)
    {
        Document.Changed -= OnDocumentChanged;
        Document.Text = content;
        Document.UndoStack.ClearAll();
        Document.Changed += OnDocumentChanged;
        SetFileEncoding(encoding, encodingName);
        IsDirty = false;
    }

    public void Undo()
    {
        if (Document.UndoStack.CanUndo)
        {
            Document.UndoStack.Undo();
        }
    }

    public void Redo()
    {
        if (Document.UndoStack.CanRedo)
        {
            Document.UndoStack.Redo();
        }
    }

    public void Dispose()
    {
        Document.Changed -= OnDocumentChanged;
    }

    partial void OnIsDirtyChanged(bool value)
    {
        OnPropertyChanged(nameof(Header));
    }

    private void OnDocumentChanged(object? sender, EventArgs eventArgs)
    {
        IsDirty = true;
    }

    public void SetFileEncoding(Encoding encoding, string encodingName)
    {
        _fileEncoding = encoding ?? new UTF8Encoding(false);
        _encodingName = string.IsNullOrWhiteSpace(encodingName) ? "UTF8" : encodingName;
        OnPropertyChanged(nameof(EncodingName));
    }

    public static (Encoding Encoding, string EncodingName) DetectEncoding(byte[] bytes)
    {
        var detector = new CharsetDetector();
        detector.Feed(bytes, 0, bytes.Length);
        detector.DataEnd();

        if (detector.Charset is not null && detector.Confidence > 0.3)
        {
            try
            {
                var encoding = Encoding.GetEncoding(detector.Charset);
                var name = detector.Charset;
                if (string.Equals(name, "utf-8", StringComparison.OrdinalIgnoreCase))
                {
                    name = "UTF8";
                }
                return (encoding, name);
            }
            catch
            {
                // fall through to UTF8 fallback
            }
        }

        return (new UTF8Encoding(false), "UTF8");
    }
}