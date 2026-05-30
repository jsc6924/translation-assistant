using System;
using Avalonia.Media;
using AvaloniaEdit.Document;
using AvaloniaEdit.Rendering;
using editor.Models;

namespace editor.Controls;

public sealed class DualLineColorizer : DocumentColorizingTransformer
{
    private static readonly IBrush OriginalPrefixBrush = new SolidColorBrush(Color.Parse("#80006c28"));
    private static readonly IBrush OriginalTextBrush = new SolidColorBrush(Color.Parse("#006c28"));
    private static readonly IBrush TranslatedPrefixBrush = new SolidColorBrush(Color.Parse("#80000000"));
    private static readonly IBrush TranslatedTextBrush = new SolidColorBrush(Color.Parse("#000000"));

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

        var prefixLength = lineInfo.PrefixLength;
        if (prefixLength <= 0)
        {
            return;
        }

        var start = line.Offset;
        var end = line.EndOffset;
        var mid = start + prefixLength;
        if (lineInfo.Kind == ParsedLineKind.Original)  
        {
            ChangeLinePart(start, mid, element =>
            {
                element.TextRunProperties.SetForegroundBrush(OriginalPrefixBrush);
            });
            ChangeLinePart(mid, end, element =>
            {
                element.TextRunProperties.SetForegroundBrush(OriginalTextBrush);
            });
        } 
        else if (lineInfo.Kind == ParsedLineKind.Translated) 
        {
            ChangeLinePart(start, mid, element =>
            {
                element.TextRunProperties.SetForegroundBrush(TranslatedPrefixBrush);
            });
            ChangeLinePart(mid, end, element =>
            {
                element.TextRunProperties.SetForegroundBrush(TranslatedTextBrush);
            });
        }

    }
}