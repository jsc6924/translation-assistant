using Avalonia.Media;
using AvaloniaEdit.Document;
using AvaloniaEdit.Rendering;
using editor.Models;

namespace editor.Controls;

public sealed class DualLineColorizer : DocumentColorizingTransformer
{
    private static readonly IBrush OriginalBrush = new SolidColorBrush(Color.Parse("#C65D2E"));
    private static readonly IBrush OriginalBackgroundBrush = new SolidColorBrush(Color.Parse("#1AF2C9B0"));
    private static readonly IBrush TranslatedBrush = new SolidColorBrush(Color.Parse("#1B6E45"));
    private static readonly IBrush TranslatedBackgroundBrush = new SolidColorBrush(Color.Parse("#1A8FD19E"));

    private ParsedDocument _parsedDocument = new(false);

    public void Update(ParsedDocument parsedDocument)
    {
        _parsedDocument = parsedDocument;
    }

    protected override void ColorizeLine(DocumentLine line)
    {
        if (line.Length == 0)
        {
            return;
        }

        var lineInfo = _parsedDocument.GetLine(line.LineNumber - 1);
        if (lineInfo is null || lineInfo.Kind == ParsedLineKind.Other)
        {
            return;
        }

        var brush = lineInfo.Kind == ParsedLineKind.Original ? OriginalBrush : TranslatedBrush;
        var backgroundBrush = lineInfo.Kind == ParsedLineKind.Original ? OriginalBackgroundBrush : TranslatedBackgroundBrush;
        ChangeLinePart(line.Offset, line.EndOffset, element =>
        {
            element.TextRunProperties.SetForegroundBrush(brush);
            element.TextRunProperties.SetBackgroundBrush(backgroundBrush);
        });
    }
}