using System;
using System.IO;
using AvaloniaEdit.Document;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using editor.Models;

namespace editor.ViewModels;

public partial class EditorDocumentViewModel : ViewModelBase, IDisposable
{
    private readonly Action<EditorDocumentViewModel> _closeRequested;

    [ObservableProperty]
    private bool _isDirty;

    [ObservableProperty]
    private ParserConfig _parserConfig;

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

    public string FilePath { get; }

    public string DisplayName => Path.GetFileName(FilePath);

    public string Header => IsDirty ? $"{DisplayName} *" : DisplayName;

    public string ToolTip => FilePath;

    public TextDocument Document { get; }

    public IRelayCommand CloseCommand { get; }

    public void ApplyParserConfig(ParserConfig parserConfig)
    {
        ParserConfig = parserConfig.Clone();
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
            File.WriteAllText(FilePath, Document.Text);
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

    public void Undo()
    {
        if (Document.UndoStack.CanUndo)
        {
            Document.UndoStack.Undo();
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
}